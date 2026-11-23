// @ts-nocheck
// Módulo de Gerenciamento de Dispositivos Conectados (USF Chico Mendes)

let _dispositivoAtualId = null;
let _dispositivoAtualNome = 'Sem nome';
let _dispositivoAtualSetor = '';
let _timerHeartbeat = null;
let _dispositivosAdminDados = [];
let _bloquearSemNomeAtivo = false;
let _ultimoResumoDispositivos = null;

function _escDisp(str) {
  if (typeof escHtml === 'function') return escHtml(str);
  return String(str ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

// Helper para verificar se está no horário de expediente (06:00 às 20:00 Recife | Seg-Sex ou Mutirão)
function isHorarioHeartbeatRecife() {
  if (typeof isDentroDoHorario === 'function') {
    return isDentroDoHorario();
  }
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Recife',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
  const hour = parseInt(new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Recife', hour: '2-digit', hour12: false
  }).format(now), 10);
  const midnight = new Date(dateStr + 'T00:00:00Z');
  const day = midnight.getUTCDay(); // 0=Dom, 6=Sab
  const DATAS_MUTIRAO = ['2026-09-26', '2026-11-07', '2026-04-11', '2026-11-14', '2026-04-18'];
  const mutiraoAtivo = typeof _mutiraoLiberadoData === 'string' && _mutiraoLiberadoData === dateStr;
  if ((day === 0 || day === 6) && !DATAS_MUTIRAO.includes(dateStr) && !mutiraoAtivo) return false;
  return (hour >= 6 && hour < 20);
}

// Inicializar identificação do dispositivo e heartbeat a cada 30s
function iniciarIdentificacaoDispositivo() {
  _dispositivoAtualId = localStorage.getItem('usf_device_id') || null;
  _dispositivoAtualNome = localStorage.getItem('usf_device_nome') || 'Sem nome';
  _dispositivoAtualSetor = localStorage.getItem('usf_device_setor') || '';
  if (typeof window.sincronizarIdentidadeDispositivoNoChat === 'function') {
    window.sincronizarIdentidadeDispositivoNoChat(_dispositivoAtualNome, _dispositivoAtualSetor);
  }

  // Primeiro heartbeat imediato
  executarHeartbeatDispositivo();

  // Polling leve a cada 30s
  if (_timerHeartbeat) clearInterval(_timerHeartbeat);
  _timerHeartbeat = setInterval(() => {
    executarHeartbeatDispositivo();
  }, 30000);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) executarHeartbeatDispositivo();
  });
}

async function executarHeartbeatDispositivo(forcarVerificacao = false) {
  if (typeof isModoTV === 'function' && isModoTV()) return;
  // Executar apenas entre 06h e 20h no fuso de Recife (exceto quando clicado para revalidar)
  if (!forcarVerificacao && !isHorarioHeartbeatRecife()) return;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (_dispositivoAtualId) {
      headers['x-device-id'] = _dispositivoAtualId;
    }

    const res = await fetch(`${API_URL}/dispositivos/heartbeat`, {
      method: 'POST',
      headers,
      credentials: 'include'
    });

    if (res.status === 423) {
      const errData = await res.json().catch(() => ({}));
      if (errData.id) {
        _dispositivoAtualId = errData.id;
        try { localStorage.setItem('usf_device_id', errData.id); } catch (e) {}
      }
      if (typeof errData.bloquear_sem_nome === 'boolean') {
        _bloquearSemNomeAtivo = errData.bloquear_sem_nome;
      }
      mostrarAlertaDispositivoBloqueado(errData);
      if (forcarVerificacao) {
        const msgEl = document.getElementById('bloqueio-status-msg');
        if (msgEl) {
          msgEl.textContent = (errData.emergencia_bloqueada || errData.motivo === 'bloqueio_total_emergencia')
            ? '⛔ BLOQUEIO TOTAL ativo. Somente o Administrador pode liberar este aparelho na aba Dispositivos de outro computador.'
            : (errData.motivo === 'bloqueado' || errData.motivo === 'excesso_tentativas'
              ? '🚫 Este aparelho ainda consta como bloqueado pela coordenação.'
              : '⏳ Ainda aguardando liberação pela coordenação. Assim que o Admin salvar um nome, clique novamente.');
          msgEl.style.color = '#b91c1c';
        }
      }
      return;
    }

    if (!res.ok) return;

    const data = await res.json();
    if (typeof data.bloquear_sem_nome === 'boolean') {
      _bloquearSemNomeAtivo = data.bloquear_sem_nome;
    }
    if (data.id) {
      _dispositivoAtualId = data.id;
      _dispositivoAtualNome = data.nome || 'Sem nome';
      _dispositivoAtualSetor = data.setor || '';
      localStorage.setItem('usf_device_id', data.id);
      localStorage.setItem('usf_device_nome', _dispositivoAtualNome);
      if (data.setor) localStorage.setItem('usf_device_setor', data.setor);
      else localStorage.removeItem('usf_device_setor');

      if (typeof window.sincronizarIdentidadeDispositivoNoChat === 'function') {
        window.sincronizarIdentidadeDispositivoNoChat(_dispositivoAtualNome, _dispositivoAtualSetor);
      }

      if (data.ativo === false || data.emergencia_bloqueada) {
        mostrarAlertaDispositivoBloqueado({
          ...data,
          motivo: data.emergencia_bloqueada ? 'bloqueio_total_emergencia' : (data.motivo_bloqueio || 'bloqueado'),
          code: 'DEVICE_BLOCKED'
        });
      } else {
        const existingOverlay = document.getElementById('bloqueio-overlay');
        if (existingOverlay) {
          existingOverlay.remove();
          if (typeof isGateAuthenticated !== 'undefined' && isGateAuthenticated && typeof iniciarCarregamentoAutenticado === 'function') {
            iniciarCarregamentoAutenticado();
          }
          if (typeof showToast === 'function') {
            showToast('✅ Dispositivo liberado com sucesso!');
          }
        }
      }
    }
  } catch (err) {
    // Falha silenciosa para não poluir console
  }
}

// Registra evento de login / passagem pelo portão de entrada
async function registrarAcessoDispositivo() {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (_dispositivoAtualId) {
      headers['x-device-id'] = _dispositivoAtualId;
    }

    const res = await fetch(`${API_URL}/dispositivos/acesso`, {
      method: 'POST',
      headers,
      credentials: 'include'
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 423) {
      if (data.id) {
        _dispositivoAtualId = data.id;
        try { localStorage.setItem('usf_device_id', data.id); } catch (e) {}
      }
      mostrarAlertaDispositivoBloqueado(data);
      return;
    }
    if (res.ok) {
      const idRet = data.id || data.deviceId;
      if (idRet) {
        _dispositivoAtualId = idRet;
        localStorage.setItem('usf_device_id', idRet);
      }
      if (typeof data.bloquear_sem_nome === 'boolean') {
        _bloquearSemNomeAtivo = data.bloquear_sem_nome;
      }
      if (data.nome !== undefined) {
        _dispositivoAtualNome = data.nome || 'Sem nome';
        _dispositivoAtualSetor = data.setor || '';
        localStorage.setItem('usf_device_nome', _dispositivoAtualNome);
        if (data.setor) localStorage.setItem('usf_device_setor', data.setor);
        else localStorage.removeItem('usf_device_setor');
        if (typeof window.sincronizarIdentidadeDispositivoNoChat === 'function') {
          window.sincronizarIdentidadeDispositivoNoChat(_dispositivoAtualNome, _dispositivoAtualSetor);
        }
      }
      if (data.ativo === false || data.bloqueado_sem_nome === true) {
        mostrarAlertaDispositivoBloqueado(data);
      }
    }
  } catch (e) {}
}

function mostrarAlertaDispositivoBloqueado(info = {}) {
  if (typeof isModoTV === 'function' && isModoTV()) return;

  const isBloqueioTotal = Boolean(
    info.emergencia_bloqueada ||
    info.bloqueio_total ||
    info.motivo === 'bloqueio_total_emergencia' ||
    info.motivo_bloqueio === 'bloqueio_total_emergencia'
  );
  const isSemNome = !isBloqueioTotal && (info.motivo === 'sem_nome' || info.code === 'DEVICE_UNNAMED');
  if (isSemNome && typeof isAdmin !== 'undefined' && isAdmin) {
    const existingAdminOverlay = document.getElementById('bloqueio-overlay');
    if (existingAdminOverlay) existingAdminOverlay.remove();
    return;
  }

  if (info.id && !_dispositivoAtualId) {
    _dispositivoAtualId = info.id;
    try { localStorage.setItem('usf_device_id', info.id); } catch (e) {}
  }

  const deviceIdExibido = info.id || _dispositivoAtualId || '';
  const codigoCurto = deviceIdExibido ? deviceIdExibido.slice(0, 8).toUpperCase() : 'PENDENTE';
  const motivoChave = isBloqueioTotal ? 'bloqueio_total' : (isSemNome ? 'sem_nome' : 'bloqueado');

  const existing = document.getElementById('bloqueio-overlay');
  if (existing) {
    if (existing.dataset.motivo === motivoChave && existing.dataset.deviceId === deviceIdExibido) {
      return;
    }
    existing.remove();
  }

  const overlay = document.createElement('div');
  overlay.id = 'bloqueio-overlay';
  overlay.dataset.motivo = motivoChave;
  overlay.dataset.deviceId = deviceIdExibido;
  overlay.style.cssText = isSemNome
    ? 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,44,115,0.96);color:#fff;z-index:999999;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px;font-family:sans-serif;'
    : 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(153,27,27,0.97);color:#fff;z-index:999999;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px;font-family:sans-serif;';

  if (isSemNome) {
    overlay.innerHTML = `
      <div style="max-width:480px;width:100%;background:#fff;color:#1f2937;padding:30px;border-radius:16px;box-shadow:0 12px 32px rgba(0,0,0,0.35);">
        <div style="font-size:48px;margin-bottom:10px;">🔒</div>
        <h2 style="color:#0f2c73;margin:0 0 10px 0;">Dispositivo Não Cadastrado</h2>
        <p style="font-size:14px;color:#4b5563;line-height:1.55;margin:0 0 14px 0;">
          O modo de acesso restrito está ativo na USF Chico Mendes. Apenas aparelhos com nome cadastrado e autorizado pelo Administrador podem operar o sistema.
        </p>
        <div style="background:#eff6ff;border:1.5px dashed #93c5fd;border-radius:10px;padding:12px;margin-bottom:14px;">
          <div style="font-size:11px;font-weight:800;color:#1d4ed8;text-transform:uppercase;">Código para informar à coordenação</div>
          <div style="font-size:22px;font-weight:900;color:#0f2c73;font-family:monospace;letter-spacing:1.5px;margin-top:4px;">${_escDisp(codigoCurto)}</div>
          ${deviceIdExibido ? `<div style="font-size:11px;color:#64748b;font-family:monospace;margin-top:4px;word-break:break-all;">${_escDisp(deviceIdExibido)}</div>` : ''}
        </div>
        <div id="bloqueio-status-msg" style="font-size:12.5px;color:#475569;min-height:18px;margin-bottom:14px;">
          Peça à coordenação para clicar em <b>"✏️ Nome"</b> na aba <b>Dispositivos</b>.
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button type="button" onclick="verificarLiberacaoDispositivoAgora()" style="width:100%;padding:11px 16px;border-radius:10px;border:none;background:#1a4fc4;color:#fff;font-size:14px;font-weight:800;cursor:pointer;">
            🔄 Já fui liberado — Verificar agora
          </button>
          <button type="button" onclick="desbloqueioEmergencialAdmin()" style="width:100%;padding:9px 14px;border-radius:10px;border:1px solid #cbd5e1;background:#f8fafc;color:#334155;font-size:12.5px;font-weight:700;cursor:pointer;">
            🔑 Acesso Emergencial (Administrador)
          </button>
        </div>
      </div>
    `;
  } else if (isBloqueioTotal) {
    overlay.innerHTML = `
      <div style="max-width:480px;width:100%;background:#fff;color:#1f2937;padding:30px;border-radius:16px;box-shadow:0 12px 32px rgba(0,0,0,0.45);border:2px solid #dc2626;">
        <div style="font-size:50px;margin-bottom:10px;">⛔</div>
        <h2 style="color:#991b1b;margin:0 0 10px 0;">BLOQUEIO TOTAL DO APARELHO</h2>
        <p style="font-size:14px;color:#374151;line-height:1.55;margin:0 0 14px 0;">
          A senha de Administrador foi digitada incorretamente <b>3 vezes</b> na tentativa de desbloqueio emergencial. Por segurança, o desbloqueio neste aparelho foi <b>bloqueado em definitivo</b>.
        </p>
        <div style="background:#fef2f2;border:1.5px dashed #fca5a5;border-radius:10px;padding:12px;margin-bottom:14px;">
          <div style="font-size:11px;font-weight:800;color:#991b1b;text-transform:uppercase;">Código do aparelho bloqueado</div>
          <div style="font-size:22px;font-weight:900;color:#7f1d1d;font-family:monospace;letter-spacing:1.5px;margin-top:4px;">${_escDisp(codigoCurto)}</div>
          ${deviceIdExibido ? `<div style="font-size:11px;color:#64748b;font-family:monospace;margin-top:4px;word-break:break-all;">${_escDisp(deviceIdExibido)}</div>` : ''}
        </div>
        <div id="bloqueio-status-msg" style="font-size:12.5px;color:#7f1d1d;font-weight:700;min-height:18px;margin-bottom:14px;">
          Solicite ao Administrador que libere este aparelho pela aba <b>Dispositivos</b> em outro computador autorizado.
        </div>
        <button type="button" onclick="verificarLiberacaoDispositivoAgora()" style="width:100%;padding:11px 16px;border-radius:10px;border:none;background:#1f2937;color:#fff;font-size:13.5px;font-weight:800;cursor:pointer;">
          🔄 Verificar se o Administrador já liberou
        </button>
      </div>
    `;
  } else {
    const isExcesso = info.motivo === 'excesso_tentativas';
    const descBloqueio = isExcesso
      ? 'Este aparelho foi <b>bloqueado automaticamente por excesso de tentativas incorretas de senha</b>. Apenas o Administrador pode desbloquear.'
      : 'Este aparelho foi desativado ou bloqueado no painel de administração da USF Chico Mendes.';
    overlay.innerHTML = `
      <div style="max-width:480px;width:100%;background:#fff;color:#1f2937;padding:30px;border-radius:16px;box-shadow:0 10px 25px rgba(0,0,0,0.3);">
        <div style="font-size:48px;margin-bottom:12px;">🚫</div>
        <h2 style="color:#b91c1c;margin:0 0 10px 0;">Dispositivo Bloqueado</h2>
        <p style="font-size:14px;color:#4b5563;line-height:1.5;">${descBloqueio}</p>
        <p style="font-size:13px;color:#6b7280;margin-top:10px;">ID do dispositivo: <code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;">${_escDisp(deviceIdExibido || 'N/A')}</code></p>
        <div id="bloqueio-status-msg" style="margin-top:14px;font-size:12px;color:#9ca3af;">Procure o Administrador para solicitar o desbloqueio.</div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:16px;">
          <button type="button" onclick="verificarLiberacaoDispositivoAgora()" style="width:100%;padding:10px 14px;border-radius:10px;border:none;background:#1f2937;color:#fff;font-size:13px;font-weight:800;cursor:pointer;">
            🔄 Verificar se já foi desbloqueado
          </button>
          <button type="button" onclick="desbloqueioEmergencialAdmin()" style="width:100%;padding:9px 14px;border-radius:10px;border:1px solid #cbd5e1;background:#f8fafc;color:#334155;font-size:12.5px;font-weight:700;cursor:pointer;">
            🔑 Acesso Emergencial (Somente Administrador)
          </button>
        </div>
      </div>
    `;
  }

  document.body.appendChild(overlay);
}

window.mostrarAlertaDispositivoBloqueado = mostrarAlertaDispositivoBloqueado;

async function verificarLiberacaoDispositivoAgora() {
  const msgEl = document.getElementById('bloqueio-status-msg');
  if (msgEl) {
    msgEl.textContent = '⏳ Verificando liberação no servidor...';
    msgEl.style.color = '#1d4ed8';
  }
  await executarHeartbeatDispositivo(true);
}

async function desbloqueioEmergencialAdmin() {
  const senha = prompt('🔑 Digite a senha EXCLUSIVA de Administrador para acesso emergencial (máx. 3 erros):');
  if (!senha) return;
  const s = senha.trim();
  if (!s) return;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (_dispositivoAtualId) {
      headers['x-device-id'] = _dispositivoAtualId;
    }
    const res = await fetch(`${API_URL}/verify-admin`, {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      body: JSON.stringify({ senha: s, modo_emergencia: true })
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 423 || data.bloqueio_total || data.emergencia_bloqueada) {
      mostrarAlertaDispositivoBloqueado({
        id: _dispositivoAtualId,
        motivo: 'bloqueio_total_emergencia',
        emergencia_bloqueada: true,
        bloqueio_total: true
      });
      alert(data.error || '⛔ BLOQUEIO TOTAL: 3 tentativas incorretas! Este aparelho só pode ser liberado pelo Administrador em outro computador.');
      return;
    }
    if (!res.ok || data.role !== 'admin') {
      const msgEl = document.getElementById('bloqueio-status-msg');
      if (msgEl && Number.isFinite(Number(data.tentativas_restantes))) {
        msgEl.textContent = `⚠️ Senha incorreta. Restam ${data.tentativas_restantes} tentativa(s) antes do BLOQUEIO TOTAL do aparelho.`;
        msgEl.style.color = '#dc2626';
      }
      alert(data.error || '🔒 Senha incorreta ou acesso restrito apenas ao Administrador!');
      return;
    }

    if (typeof isAdmin !== 'undefined') isAdmin = true;
    if (typeof isGerente !== 'undefined') isGerente = false;
    if (typeof userRole !== 'undefined') userRole = 'admin';
    if (typeof adminPassword !== 'undefined') adminPassword = s;
    try {
      sessionStorage.setItem('usf_admin_pwd', s);
      sessionStorage.setItem('usf_user_role', 'admin');
    } catch (e) {}

    if (typeof isGateAuthenticated !== 'undefined') isGateAuthenticated = true;
    try {
      sessionStorage.setItem('usf_gate_auth', 'true');
      sessionStorage.setItem('usf_gate_time', Date.now().toString());
    } catch (e) {}

    const existingOverlay = document.getElementById('bloqueio-overlay');
    if (existingOverlay) existingOverlay.remove();

    if (typeof hideGate === 'function') hideGate();
    if (typeof updateAdminUI === 'function') updateAdminUI();
    if (typeof iniciarCarregamentoAutenticado === 'function') iniciarCarregamentoAutenticado();
    if (typeof showScreen === 'function') showScreen('dispositivos');
    if (typeof showToast === 'function') {
      showToast('🔓 Acesso emergencial Admin liberado! Nomeie ou desbloqueie este aparelho na aba Dispositivos.');
    }
  } catch (err) {
    alert('🔴 Erro de conexão ao validar acesso administrativo.');
  }
}

// ====== PAINEL ADMIN: DISPOSITIVOS CONECTADOS ======

async function carregarDispositivosAdmin() {
  const container = document.getElementById('disp-lista-container');
  if (!container) return;

  if (!isAdmin || !adminPassword) {
    container.innerHTML = `
      <div style="text-align:center;padding:40px 20px;background:#fff;border-radius:12px;border:1px dashed var(--gray-300);">
        <div style="font-size:32px;margin-bottom:8px;">🔒</div>
        <div style="font-weight:700;font-size:15px;color:var(--gray-800);">Acesso Restrito ao Administrador</div>
        <p style="font-size:13px;color:var(--gray-600);margin:6px 0 16px 0;">Ative o Modo Administrador no topo para gerenciar os aparelhos conectados.</p>
        <button class="btn btn-primary btn-sm" onclick="toggleAdmin()">🔓 Entrar como Admin</button>
      </div>
    `;
    return;
  }

  container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--gray-500);"><div class="spinner" style="margin:0 auto 10px;"></div>Carregando dispositivos conectados...</div>';

  const setorFiltro = document.getElementById('disp-filtro-setor')?.value || '';
  const statusFiltro = document.getElementById('disp-filtro-status')?.value || '';

  const params = new URLSearchParams();
  if (setorFiltro) params.set('setor', setorFiltro);
  if (statusFiltro) params.set('status', statusFiltro);

  try {
    const res = await fetch(`${API_URL}/admin/dispositivos?${params.toString()}`, {
      headers: {
        'x-admin-password': adminPassword
      }
    });

    if (res.status === 403) {
      container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--red);">Senha administrativa inválida ou sessão expirada.</div>';
      return;
    }
    if (!res.ok) throw new Error();

    const data = await res.json();
    _dispositivosAdminDados = data.dispositivos || [];
    _bloquearSemNomeAtivo = Boolean(data.config && data.config.bloquear_sem_nome);
    _ultimoResumoDispositivos = data.resumo || null;

    // Renderizar resumo, chave de bloqueio global e alertas
    renderizarResumoDispositivos(_ultimoResumoDispositivos, _dispositivosAdminDados);
    renderizarControleBloqueioSemNome(_bloquearSemNomeAtivo, _ultimoResumoDispositivos);
    renderizarAlertasDispositivos(data.alertas);

    // Renderizar tabela de dispositivos
    renderizarTabelaDispositivos(_dispositivosAdminDados, container);
  } catch (err) {
    console.error('Erro ao carregar dispositivos:', err);
    container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--red);">Erro ao carregar lista de dispositivos.</div>';
  }
}

function renderizarControleBloqueioSemNome(ativo, resumo) {
  const container = document.getElementById('disp-bloqueio-sem-nome-card');
  if (!container) return;

  const comNome = Number((resumo && resumo.com_nome) || (_dispositivosAdminDados || []).filter(d => d.nome && d.nome !== 'Sem nome').length || 0);
  const semNome = Number((resumo && resumo.sem_nome) || (_dispositivosAdminDados || []).filter(d => !d.nome || d.nome === 'Sem nome').length || 0);

  if (ativo) {
    container.innerHTML = `
      <div class="card-white" style="padding:16px 18px;border:2px solid #dc2626;background:linear-gradient(135deg,#fff5f5,#fee2e2);display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;">
        <div style="flex:1;min-width:250px;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
            <span style="background:#dc2626;color:#fff;font-size:11px;font-weight:900;padding:3px 10px;border-radius:999px;letter-spacing:0.4px;">🛡️ MODO RESTRITO ATIVO</span>
            <span style="font-size:15px;font-weight:900;color:#7f1d1d;">Bloqueio de dispositivos não cadastrados LIGADO</span>
          </div>
          <div style="font-size:12.5px;color:#7f1d1d;line-height:1.45;">
            Apenas dispositivos com nome cadastrado (<b>${comNome}</b>) podem acessar o sistema. Os <b>${semNome}</b> aparelho(s) sem nome e novos aparelhos ficam bloqueados até você clicar em <b>"✏️ Nome"</b>. <i>TV, QR Code de pacientes e Admin continuam isentos.</i>
          </div>
        </div>
        <button type="button" class="btn btn-sm" onclick="alternarBloqueioDispositivosSemNome()" style="background:#ffffff;color:#991b1b;border:2px solid #dc2626;font-weight:900;padding:10px 16px;white-space:nowrap;">
          🔓 Desligar Bloqueio (Voltar ao Modo Aberto)
        </button>
      </div>
    `;
  } else {
    container.innerHTML = `
      <div class="card-white" style="padding:16px 18px;border:2px solid #93c5fd;background:linear-gradient(135deg,#f8fafc,#eff6ff);display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;">
        <div style="flex:1;min-width:250px;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
            <span style="background:#16a34a;color:#fff;font-size:11px;font-weight:900;padding:3px 10px;border-radius:999px;letter-spacing:0.4px;">🔓 MODO ABERTO</span>
            <span style="font-size:15px;font-weight:900;color:#1e3a8a;">Bloqueio de dispositivos não cadastrados DESLIGADO</span>
          </div>
          <div style="font-size:12.5px;color:#334155;line-height:1.45;">
            No momento há <b>${comNome}</b> aparelho(s) com nome e <b>${semNome}</b> sem nome. Quando todos os PCs da USF já tiverem nome, clique ao lado para bloquear qualquer aparelho sem cadastro. <i>TV, QR Code de pacientes e Admin nunca são bloqueados.</i>
          </div>
        </div>
        <button type="button" class="btn btn-sm" onclick="alternarBloqueioDispositivosSemNome()" style="background:#b91c1c;color:#fff;border:none;font-weight:900;padding:10px 16px;white-space:nowrap;box-shadow:0 3px 10px rgba(185,28,28,0.28);">
          🔒 Bloquear Dispositivos Não Cadastrados
        </button>
      </div>
    `;
  }
}

async function alternarBloqueioDispositivosSemNome() {
  const novoEstado = !_bloquearSemNomeAtivo;
  const r = _ultimoResumoDispositivos || {
    com_nome: (_dispositivosAdminDados || []).filter(d => d.nome && d.nome !== 'Sem nome').length,
    sem_nome: (_dispositivosAdminDados || []).filter(d => !d.nome || d.nome === 'Sem nome').length
  };
  const comNome = Number(r.com_nome || 0);
  const semNome = Number(r.sem_nome || 0);

  if (novoEstado) {
    const selfDev = (_dispositivosAdminDados || []).find(d => d.id === _dispositivoAtualId);
    const selfNome = selfDev ? selfDev.nome : _dispositivoAtualNome;
    const selfTemNome = Boolean(selfNome && String(selfNome).trim() && String(selfNome).trim().toLowerCase() !== 'sem nome');
    if (!selfTemNome) {
      showToast('⚠️ Antes de ativar o bloqueio, dê um nome a ESTE APARELHO na tabela abaixo!', true);
      return;
    }

    const msgConfirm =
      `🛡️ ATIVAR BLOQUEIO DE DISPOSITIVOS NÃO CADASTRADOS?\n\n` +
      `• Dispositivos identificados (COM NOME): ${comNome} — continuarão com acesso normal.\n` +
      `• Dispositivos pendentes (SEM NOME): ${semNome} — serão bloqueados até receberem um nome aqui.\n` +
      `• Painel TV, QR Code dos pacientes e acesso de Administrador NÃO são bloqueados.\n\n` +
      `Deseja ativar o bloqueio agora?`;
    if (!confirm(msgConfirm)) return;
  } else {
    const msgDesativar =
      `🔓 DESATIVAR BLOQUEIO DE DISPOSITIVOS NÃO CADASTRADOS?\n\n` +
      `Qualquer computador ou celular com a senha da USF voltará a acessar mesmo sem nome cadastrado.\n\n` +
      `Deseja voltar ao modo aberto?`;
    if (!confirm(msgDesativar)) return;
  }

  try {
    const headers = {
      'Content-Type': 'application/json',
      'x-admin-password': adminPassword || ''
    };
    if (_dispositivoAtualId) {
      headers['x-device-id'] = _dispositivoAtualId;
    }

    const res = await fetch(`${API_URL}/admin/dispositivos/config-bloqueio-sem-nome`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        senha: adminPassword || '',
        bloquear_sem_nome: novoEstado
      })
    });

    const data = await res.json().catch(() => ({}));
    if (res.status === 403) {
      showToast('❌ Senha administrativa incorreta ou expirada!', true);
      return;
    }
    if (!res.ok) {
      showToast(data.error || 'Não foi possível alterar o bloqueio global.', true);
      return;
    }

    _bloquearSemNomeAtivo = Boolean(data.bloquear_sem_nome);
    showToast(
      _bloquearSemNomeAtivo
        ? '🛡️ Bloqueio ativo! Apenas dispositivos com nome cadastrado podem acessar.'
        : '🔓 Modo aberto restaurado! Dispositivos sem nome voltaram a ter acesso.'
    );
    await carregarDispositivosAdmin();
  } catch (err) {
    showToast('Erro de conexão ao salvar configuração de bloqueio.', true);
  }
}

function renderizarResumoDispositivos(resumo, listaFallback) {
  const container = document.getElementById('disp-resumo-bar');
  if (!container) return;
  const r = resumo || {
    total: (listaFallback || []).length,
    online: (listaFallback || []).filter(d => d.online).length,
    com_nome: (listaFallback || []).filter(d => d.nome && d.nome !== 'Sem nome').length,
    sem_nome: (listaFallback || []).filter(d => !d.nome || d.nome === 'Sem nome').length,
    bloqueados: (listaFallback || []).filter(d => d.ativo === false).length
  };
  container.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;">
      <div class="card-white" style="padding:12px 14px;border-left:4px solid var(--blue);">
        <div style="font-size:11px;font-weight:800;color:var(--gray-500);text-transform:uppercase;">Total Registrados</div>
        <div style="font-size:22px;font-weight:900;color:var(--blue-dark);">${Number(r.total || 0)}</div>
      </div>
      <div class="card-white" style="padding:12px 14px;border-left:4px solid #16a34a;">
        <div style="font-size:11px;font-weight:800;color:var(--gray-500);text-transform:uppercase;">🟢 Online Agora</div>
        <div style="font-size:22px;font-weight:900;color:#15803d;">${Number(r.online || 0)}</div>
      </div>
      <div class="card-white" style="padding:12px 14px;border-left:4px solid #0284c7;">
        <div style="font-size:11px;font-weight:800;color:var(--gray-500);text-transform:uppercase;">💬 Com Nome (Chat)</div>
        <div style="font-size:22px;font-weight:900;color:#0369a1;">${Number(r.com_nome || 0)}</div>
      </div>
      <div class="card-white" style="padding:12px 14px;border-left:4px solid #d97706;">
        <div style="font-size:11px;font-weight:800;color:var(--gray-500);text-transform:uppercase;">⚠️ Sem Nome</div>
        <div style="font-size:22px;font-weight:900;color:#b45309;">${Number(r.sem_nome || 0)}</div>
      </div>
      <div class="card-white" style="padding:12px 14px;border-left:4px solid #dc2626;">
        <div style="font-size:11px;font-weight:800;color:var(--gray-500);text-transform:uppercase;">🚫 Bloqueados</div>
        <div style="font-size:22px;font-weight:900;color:#b91c1c;">${Number(r.bloqueados || 0)}</div>
      </div>
    </div>
  `;
}

function renderizarAlertasDispositivos(alertas) {
  const container = document.getElementById('disp-alertas-container');
  if (!container) return;

  const alertasHtml = [];

  if (alertas && alertas.aparelhos_sem_nome > 0) {
    alertasHtml.push(`
      <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:#fef3c7;border:1px solid #fcd34d;border-radius:10px;color:#92400e;font-size:13px;margin-bottom:10px;">
        <span style="font-size:18px;">⚠️</span>
        <div style="flex:1;">
          <b>Novo aparelho conectado!</b> Existe(m) <b>${alertas.aparelhos_sem_nome}</b> dispositivo(s) cadastrado(s) como "Sem nome". Atribua um nome e setor para identificá-lo nos históricos.
        </div>
      </div>
    `);
  }

  if (alertas && alertas.online_fora_horario > 0) {
    alertasHtml.push(`
      <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:#fee2e2;border:1px solid #fca5a5;border-radius:10px;color:#991b1b;font-size:13px;margin-bottom:10px;">
        <span style="font-size:18px;">🌙</span>
        <div style="flex:1;">
          <b>Atenção: Atividade fora do expediente!</b> Há <b>${alertas.online_fora_horario}</b> aparelho(s) ativo(s) fora do horário das 06:00 às 18:00 ou em final de semana.
        </div>
      </div>
    `);
  }

  container.innerHTML = alertasHtml.join('');
}

function renderizarTabelaDispositivos(lista, container) {
  if (!lista || lista.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:40px 20px;background:#fff;border-radius:12px;border:1px dashed var(--gray-300);">
        <div style="font-size:32px;margin-bottom:8px;">💻</div>
        <div style="font-weight:700;font-size:15px;color:var(--gray-800);">Nenhum dispositivo encontrado</div>
        <p style="font-size:13px;color:var(--gray-600);margin-top:4px;">Aguarde os aparelhos conectarem ou altere os filtros.</p>
      </div>
    `;
    return;
  }

  const linhas = lista.map(d => {
    const isOnline = d.online === true;
    const isBloqueado = d.ativo === false;

    const ehAparelhoAtual = d.id === _dispositivoAtualId;
    const temNomeOficial = Boolean(d.nome && String(d.nome).trim() && String(d.nome).trim().toLowerCase() !== 'sem nome');

    let statusBadge = '';
    if (isBloqueado) {
      statusBadge = '<span style="background:#fee2e2;color:#991b1b;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:800;">🚫 Bloqueado</span>';
    } else if (_bloquearSemNomeAtivo && !temNomeOficial) {
      statusBadge = '<span style="background:#fef3c7;color:#b45309;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:800;">🔒 Aguardando Nome</span>';
    } else if (isOnline) {
      statusBadge = '<span style="background:#dcfce7;color:#166534;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:800;">🟢 Online</span>';
    } else {
      statusBadge = '<span style="background:#f3f4f6;color:#4b5563;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">⚪ Offline</span>';
    }

    const dtUltimo = d.ultimo_acesso 
      ? new Date(d.ultimo_acesso).toLocaleString('pt-BR', { timeZone: 'America/Recife', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) 
      : 'Nunca';

    const dtPrimeiro = d.primeiro_acesso 
      ? new Date(d.primeiro_acesso).toLocaleDateString('pt-BR', { timeZone: 'America/Recife' }) 
      : '-';

    const chatIdentBadge = temNomeOficial
      ? `<div style="font-size:11px;color:#15803d;font-weight:700;margin-top:2px;">💬 Chat Interno: ${escHtml(d.nome)}</div>`
      : (_bloquearSemNomeAtivo
          ? `<div style="font-size:11px;color:#b91c1c;font-weight:700;margin-top:2px;">🔒 Bloqueado por estar sem nome — clique em "✏️ Nome" para liberar</div>`
          : `<div style="font-size:11px;color:#b45309;font-weight:700;margin-top:2px;">⚠️ Sem nome (modo livre — sem bloqueio)</div>`);

    return `
      <tr style="border-bottom:1px solid var(--gray-200);background:${ehAparelhoAtual ? 'rgba(26,79,196,0.04)' : '#fff'};">
        <td style="padding:12px 10px;">
          <div style="font-weight:800;color:var(--blue-dark);font-size:14px;display:flex;align-items:center;gap:6px;">
            ${escHtml(d.nome || 'Sem nome')}
            ${ehAparelhoAtual ? '<span style="background:var(--blue);color:#fff;font-size:10px;padding:1px 6px;border-radius:4px;">ESTE APARELHO</span>' : ''}
          </div>
          ${chatIdentBadge}
          <div style="font-size:11px;color:var(--gray-500);margin-top:2px;font-family:monospace;">UUID: ${escHtml(d.id.substring(0, 8))}...</div>
        </td>
        <td style="padding:12px 10px;">
          <span style="font-weight:700;font-size:12px;color:#0284c7;background:#e0f2fe;padding:2px 8px;border-radius:6px;">
            ${escHtml(d.setor || 'Não definido')}
          </span>
        </td>
        <td style="padding:12px 10px;text-align:center;">
          ${statusBadge}
        </td>
        <td style="padding:12px 10px;font-size:12px;">
          <div style="font-family:monospace;color:var(--gray-800);">${escHtml(d.ultimo_ip || 'Desconhecido')}</div>
          <div style="font-size:11px;color:var(--gray-500);">${escHtml(d.user_agent || '-')}</div>
        </td>
        <td style="padding:12px 10px;font-size:12px;">
          <div><b>Último:</b> ${dtUltimo}</div>
          <div style="font-size:11px;color:var(--gray-500);">Desde: ${dtPrimeiro}</div>
        </td>
        <td style="padding:12px 10px;text-align:center;">
          <div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap;">
            <button class="btn btn-outline btn-sm" onclick="abrirModalEditarDispositivo('${d.id}', '${escHtml(d.nome)}', '${escHtml(d.setor || '')}')" title="Renomear / Mudar Setor" style="padding:4px 8px;font-size:11px;">
              ✏️ Nome
            </button>
            <button class="btn btn-outline btn-sm" onclick="alternarBloqueioDispositivo('${d.id}', ${d.ativo})" title="${d.ativo ? 'Bloquear aparelho' : 'Desbloquear aparelho'}" style="padding:4px 8px;font-size:11px;color:${d.ativo ? 'var(--red)' : '#15803d'};border-color:${d.ativo ? '#fca5a5' : '#86efac'};">
              ${d.ativo ? '🔒 Bloquear' : '🔓 Desbloquear'}
            </button>
            <button class="btn btn-outline btn-sm" onclick="abrirModalHistoricoLogins('${d.id}', '${escHtml(d.nome)}')" title="Ver histórico de logins (30 dias)" style="padding:4px 8px;font-size:11px;">
              📜 Logins
            </button>
            <button class="btn btn-outline btn-sm" onclick="excluirDispositivo('${d.id}', '${escHtml(d.nome || 'Sem nome').replace(/'/g, "\\'")}')" title="Excluir aparelho permanentemente" style="padding:4px 8px;font-size:11px;color:#b91c1c;border-color:#fca5a5;">
              🗑️ Excluir
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="agend-table" style="width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;">
        <thead>
          <tr style="background:var(--blue);color:white;">
            <th style="padding:10px;text-align:left;">Identificação / Aparelho</th>
            <th style="padding:10px;text-align:left;">Setor</th>
            <th style="padding:10px;text-align:center;">Status</th>
            <th style="padding:10px;text-align:left;">IP & Navegador</th>
            <th style="padding:10px;text-align:left;">Atividade</th>
            <th style="padding:10px;text-align:center;width:170px;">Ações</th>
          </tr>
        </thead>
        <tbody>
          ${linhas}
        </tbody>
      </table>
    </div>
  `;
}

// Modal Editar Nome e Setor
let _dispositivoEdicaoId = null;

function abrirModalEditarDispositivo(id, nomeAtual, setorAtual) {
  _dispositivoEdicaoId = id;
  const modal = document.getElementById('modal-editar-dispositivo');
  const inpNome = document.getElementById('edit-disp-nome');
  const selSetor = document.getElementById('edit-disp-setor');

  if (inpNome) inpNome.value = (nomeAtual === 'Sem nome' ? '' : nomeAtual);
  if (selSetor) selSetor.value = setorAtual || '';

  if (modal) modal.classList.add('show');
}

function fecharModalEditarDispositivo() {
  const modal = document.getElementById('modal-editar-dispositivo');
  if (modal) modal.classList.remove('show');
  _dispositivoEdicaoId = null;
}

async function salvarEditarDispositivo() {
  if (!_dispositivoEdicaoId) return;
  const editedId = _dispositivoEdicaoId;

  const nome = document.getElementById('edit-disp-nome')?.value.trim();
  const setor = document.getElementById('edit-disp-setor')?.value;

  if (!nome) {
    showToast('⚠️ Informe um nome para identificar o aparelho!', true);
    return;
  }

  try {
    const res = await fetch(`${API_URL}/admin/dispositivos/${encodeURIComponent(editedId)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-password': adminPassword || ''
      },
      body: JSON.stringify({
        senha: adminPassword,
        nome,
        setor
      })
    });

    if (res.status === 403) {
      showToast('❌ Senha administrativa incorreta!', true);
      return;
    }
    if (!res.ok) throw new Error();

    showToast('✅ Dispositivo atualizado com sucesso!');
    fecharModalEditarDispositivo();
    carregarDispositivosAdmin();

    // Se editou o próprio dispositivo, atualizar localmente e sincronizar no Chat Interno
    if (editedId === _dispositivoAtualId) {
      _dispositivoAtualNome = nome;
      _dispositivoAtualSetor = setor || '';
      localStorage.setItem('usf_device_nome', nome);
      if (setor) localStorage.setItem('usf_device_setor', setor);
      else localStorage.removeItem('usf_device_setor');
      if (typeof window.sincronizarIdentidadeDispositivoNoChat === 'function') {
        window.sincronizarIdentidadeDispositivoNoChat(nome, setor || '');
      }
    }
  } catch (err) {
    showToast('Erro ao atualizar dispositivo!', true);
  }
}

// Bloquear / Desbloquear Aparelho
async function alternarBloqueioDispositivo(id, statusAtivoAtual) {
  const estaAtivo = statusAtivoAtual !== false && statusAtivoAtual !== 'false';
  const novoStatus = !estaAtivo;
  const acaoNome = novoStatus ? 'desbloquear' : 'BLOQUEAR';

  if (!confirm(`Tem certeza de que deseja ${acaoNome} este dispositivo? ${novoStatus ? 'Ele voltará a ter acesso às requisições do sistema.' : 'Ele perderá todo o acesso às requisições do sistema.'}`)) {
    return;
  }

  const executar = async (senhaAdmin) => {
    try {
      const res = await fetch(`${API_URL}/admin/dispositivos/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': senhaAdmin
        },
        body: JSON.stringify({
          senha: senhaAdmin,
          ativo: novoStatus
        })
      });

      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        showToast('❌ Senha administrativa incorreta!', true);
        return;
      }
      if (!res.ok) {
        showToast(data.error || 'Erro ao alterar status do dispositivo!', true);
        return;
      }

      showToast(`✅ Dispositivo ${novoStatus ? 'desbloqueado' : 'bloqueado'} com sucesso!`);
      await carregarDispositivosAdmin();
    } catch (err) {
      showToast('Erro de conexão ao alterar status do dispositivo!', true);
    }
  };

  if (typeof pedirSenhaAdmin === 'function') {
    pedirSenhaAdmin(`${acaoNome} dispositivo`, executar);
  } else {
    executar(adminPassword || '');
  }
}

// Modal Histórico de Logins (últimos 30 dias)
async function abrirModalHistoricoLogins(id, nome) {
  const modal = document.getElementById('modal-logins-dispositivo');
  const titulo = document.getElementById('modal-logins-disp-titulo');
  const container = document.getElementById('modal-logins-disp-lista');

  if (titulo) titulo.textContent = `Histórico de Acessos: ${nome}`;
  if (container) container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray-500);">Carregando registros...</div>';
  if (modal) modal.classList.add('show');

  try {
    const res = await fetch(`${API_URL}/admin/dispositivos/${id}/acessos`, {
      headers: { 'x-admin-password': adminPassword }
    });
    if (!res.ok) throw new Error();
    const lista = await res.json();

    if (!lista || lista.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray-500);">Nenhum registro de acesso nos últimos 30 dias.</div>';
      return;
    }

    const linhas = lista.map(item => {
      const dt = new Date(item.criado_em).toLocaleString('pt-BR', { timeZone: 'America/Recife' });
      const tipoLabel = item.tipo === 'login' ? '🔑 Login / Entrada' : '📡 Primeiro acesso do dia';
      return `
        <tr style="border-bottom:1px solid var(--gray-200);">
          <td style="padding:8px 10px;font-size:12px;">${dt}</td>
          <td style="padding:8px 10px;font-size:12px;font-weight:700;">${tipoLabel}</td>
          <td style="padding:8px 10px;font-size:12px;font-family:monospace;">${escHtml(item.ip || '-')}</td>
          <td style="padding:8px 10px;font-size:11px;color:var(--gray-600);">${escHtml(item.user_agent || '-')}</td>
        </tr>
      `;
    }).join('');

    container.innerHTML = `
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:var(--gray-100);font-size:11px;text-transform:uppercase;color:var(--gray-600);border-bottom:2px solid var(--gray-200);">
            <th style="padding:8px 10px;text-align:left;">Data / Hora</th>
            <th style="padding:8px 10px;text-align:left;">Evento</th>
            <th style="padding:8px 10px;text-align:left;">IP</th>
            <th style="padding:8px 10px;text-align:left;">Navegador/SO</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>
    `;
  } catch (err) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--red);">Erro ao carregar histórico de acessos.</div>';
  }
}

function fecharModalHistoricoLogins() {
  const modal = document.getElementById('modal-logins-dispositivo');
  if (modal) modal.classList.remove('show');
}

function obterDispositivosFiltrados() {
  const q = (document.getElementById('disp-filtro-busca')?.value || '').trim().toLowerCase();
  if (!q) return _dispositivosAdminDados;
  return _dispositivosAdminDados.filter(d =>
    String(d.nome || '').toLowerCase().includes(q) ||
    String(d.setor || '').toLowerCase().includes(q) ||
    String(d.ultimo_ip || '').toLowerCase().includes(q) ||
    String(d.id || '').toLowerCase().includes(q)
  );
}

function filtrarDispositivosLocal() {
  const container = document.getElementById('disp-lista-container');
  if (container) renderizarTabelaDispositivos(obterDispositivosFiltrados(), container);
}

async function excluirDispositivo(id, nome) {
  if (!confirm(`🗑️ Deseja EXCLUIR permanentemente o aparelho "${nome}"?\n\nIsso removerá o registro e o histórico de acessos dele.`)) return;
  try {
    const res = await fetch(`${API_URL}/admin/dispositivos/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-password': adminPassword || ''
      },
      body: JSON.stringify({ senha: adminPassword || '' })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error || 'Erro ao excluir aparelho.', true);
      return;
    }
    showToast(`🗑️ Aparelho "${nome}" excluído com sucesso!`);
    await carregarDispositivosAdmin();
  } catch (err) {
    showToast('Erro de conexão ao excluir aparelho.', true);
  }
}

async function limparDispositivosAntigos() {
  if (!confirm('🧹 Remover todos os aparelhos sem acesso há mais de 30 dias?')) return;
  try {
    const res = await fetch(`${API_URL}/admin/dispositivos/limpar-antigos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-password': adminPassword || ''
      },
      body: JSON.stringify({ senha: adminPassword || '' })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error || 'Erro ao limpar aparelhos antigos.', true);
      return;
    }
    showToast(`🧹 ${data.removidos || 0} aparelho(s) antigo(s) removido(s)!`);
    await carregarDispositivosAdmin();
  } catch (err) {
    showToast('Erro de conexão ao limpar aparelhos antigos.', true);
  }
}

// Impressão / PDF A4 de dispositivos conectados (usa jsPDF para não conflitar com @media print da etiqueta 58mm)
function imprimirListaDispositivos() {
  const listaImpressao = obterDispositivosFiltrados();
  if (!listaImpressao.length) {
    showToast('Nenhum dispositivo para imprimir.', true);
    return;
  }

  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Recife' });

  if (window.jspdf && window.jspdf.jsPDF) {
    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      doc.setFontSize(14);
      doc.setTextColor(26, 79, 196);
      doc.text('USF Chico Mendes — Dispositivos Conectados e Auditoria', 14, 16);
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text(`Total de aparelhos: ${listaImpressao.length}  |  Emitido em: ${agora} (Fuso Recife)`, 14, 22);

      const bodyRows = listaImpressao.map((d, idx) => {
        const statusLabel = d.ativo === false ? 'Bloqueado' : (d.online ? 'Online' : 'Offline');
        const dtUltimo = d.ultimo_acesso
          ? new Date(d.ultimo_acesso).toLocaleString('pt-BR', { timeZone: 'America/Recife' })
          : 'Nunca';
        return [
          String(idx + 1),
          `${d.nome || 'Sem nome'}\n${String(d.id || '').slice(0, 13)}...`,
          d.setor || '-',
          statusLabel,
          `${d.ultimo_ip || '-'}\n${d.user_agent || '-'}`,
          dtUltimo
        ];
      });

      if (typeof doc.autoTable === 'function') {
        doc.autoTable({
          startY: 26,
          head: [['Nº', 'Dispositivo / ID', 'Setor', 'Status', 'IP & Navegador', 'Último Acesso']],
          body: bodyRows,
          styles: { fontSize: 8, cellPadding: 2.5, overflow: 'linebreak' },
          headStyles: { fillColor: [26, 79, 196], textColor: 255, fontStyle: 'bold' },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          columnStyles: { 0: { cellWidth: 10, halign: 'center' }, 3: { cellWidth: 20, halign: 'center' } }
        });
      }

      doc.save(`dispositivos-usf-${new Date().toISOString().slice(0, 10)}.pdf`);
      showToast('📄 PDF A4 dos dispositivos gerado com sucesso!');
      return;
    } catch (err) {
      console.warn('Erro ao gerar PDF com jsPDF, usando janela de impressão:', err);
    }
  }

  // Fallback: janela dedicada A4 (sem conflito com etiqueta 58mm)
  const linhas = listaImpressao.map((d, idx) => {
    const statusLabel = d.ativo === false ? 'Bloqueado' : (d.online ? 'Online' : 'Offline');
    const dtUltimo = d.ultimo_acesso ? new Date(d.ultimo_acesso).toLocaleString('pt-BR', { timeZone: 'America/Recife' }) : 'Nunca';
    return `<tr>
      <td style="text-align:center;">${idx + 1}</td>
      <td><b>${escHtml(d.nome || 'Sem nome')}</b><br><small>${escHtml(d.id)}</small></td>
      <td>${escHtml(d.setor || '-')}</td>
      <td style="text-align:center;">${statusLabel}</td>
      <td>${escHtml(d.ultimo_ip || '-')}<br><small>${escHtml(d.user_agent || '-')}</small></td>
      <td>${dtUltimo}</td>
    </tr>`;
  }).join('');
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) { showToast('Permita pop-ups para imprimir a lista.', true); return; }
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Dispositivos USF</title>
    <style>body{font-family:Arial,sans-serif;padding:18px;color:#111}h2{color:#1a4fc4;margin:0 0 4px}table{width:100%;border-collapse:collapse;font-size:11px;margin-top:12px}th,td{border:1px solid #cbd5e1;padding:6px;text-align:left}th{background:#1a4fc4;color:#fff}@page{size:A4 portrait;margin:12mm}</style>
    </head><body><h2>USF Chico Mendes — Dispositivos Conectados</h2><small>Total: ${listaImpressao.length} | Emitido em: ${agora}</small>
    <table><thead><tr><th>Nº</th><th>Dispositivo</th><th>Setor</th><th>Status</th><th>IP & Navegador</th><th>Último Acesso</th></tr></thead><tbody>${linhas}</tbody></table>
    </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 300);
}

// Iniciar ao carregar DOM
document.addEventListener('DOMContentLoaded', () => {
  iniciarIdentificacaoDispositivo();
});
