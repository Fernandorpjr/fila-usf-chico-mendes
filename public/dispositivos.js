// @ts-nocheck
// Módulo de Gerenciamento de Dispositivos Conectados (USF Chico Mendes)

let _dispositivoAtualId = null;
let _dispositivoAtualNome = 'Sem nome';
let _dispositivoAtualSetor = '';
let _timerHeartbeat = null;
let _dispositivosAdminDados = [];

// Helper para verificar se está no horário de expediente (06:00 às 18:00 Recife)
function isHorarioHeartbeatRecife() {
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
  if ((day === 0 || day === 6) && !DATAS_MUTIRAO.includes(dateStr)) return false;
  return (hour >= 6 && hour < 18);
}

// Inicializar identificação do dispositivo e heartbeat a cada 60s
function iniciarIdentificacaoDispositivo() {
  _dispositivoAtualId = localStorage.getItem('usf_device_id') || null;

  // Primeiro heartbeat imediato
  executarHeartbeatDispositivo();

  // Polling leve a cada 60s
  if (_timerHeartbeat) clearInterval(_timerHeartbeat);
  _timerHeartbeat = setInterval(() => {
    executarHeartbeatDispositivo();
  }, 60000);
}

async function executarHeartbeatDispositivo() {
  // Executar apenas entre 06h e 18h no fuso de Recife
  if (!isHorarioHeartbeatRecife()) return;

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
      // Dispositivo bloqueado pelo administrador
      mostrarAlertaDispositivoBloqueado();
      return;
    }

    if (!res.ok) return;

    const data = await res.json();
    if (data.id) {
      _dispositivoAtualId = data.id;
      _dispositivoAtualNome = data.nome || 'Sem nome';
      _dispositivoAtualSetor = data.setor || '';
      localStorage.setItem('usf_device_id', data.id);
      localStorage.setItem('usf_device_nome', _dispositivoAtualNome);
      if (data.setor) localStorage.setItem('usf_device_setor', data.setor);

      if (data.ativo === false) {
        mostrarAlertaDispositivoBloqueado();
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
    if (res.ok) {
      const data = await res.json();
      if (data.deviceId) {
        _dispositivoAtualId = data.deviceId;
        localStorage.setItem('usf_device_id', data.deviceId);
      }
    }
  } catch (e) {}
}

function mostrarAlertaDispositivoBloqueado() {
  const overlay = document.createElement('div');
  overlay.id = 'bloqueio-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(185,28,28,0.95);color:#fff;z-index:999999;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px;font-family:sans-serif;';
  overlay.innerHTML = `
    <div style="max-width:480px;background:#fff;color:#1f2937;padding:30px;border-radius:16px;box-shadow:0 10px 25px rgba(0,0,0,0.3);">
      <div style="font-size:48px;margin-bottom:12px;">🚫</div>
      <h2 style="color:#b91c1c;margin:0 0 10px 0;">Dispositivo Bloqueado</h2>
      <p style="font-size:14px;color:#4b5563;line-height:1.5;">Este aparelho foi desativado ou bloqueado no painel de administração da USF Chico Mendes.</p>
      <p style="font-size:13px;color:#6b7280;margin-top:10px;">ID do dispositivo: <code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;">${_dispositivoAtualId || 'N/A'}</code></p>
      <div style="margin-top:20px;font-size:12px;color:#9ca3af;">Procure a coordenação para solicitar o desbloqueio.</div>
    </div>
  `;
  document.body.appendChild(overlay);
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

    // Renderizar avisos/alertas
    renderizarAlertasDispositivos(data.alertas);

    // Renderizar tabela de dispositivos
    renderizarTabelaDispositivos(_dispositivosAdminDados, container);
  } catch (err) {
    console.error('Erro ao carregar dispositivos:', err);
    container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--red);">Erro ao carregar lista de dispositivos.</div>';
  }
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

    let statusBadge = '';
    if (isBloqueado) {
      statusBadge = '<span style="background:#fee2e2;color:#991b1b;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:800;">🚫 Bloqueado</span>';
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

    const ehAparelhoAtual = d.id === _dispositivoAtualId;

    return `
      <tr style="border-bottom:1px solid var(--gray-200);background:${ehAparelhoAtual ? 'rgba(26,79,196,0.04)' : '#fff'};">
        <td style="padding:12px 10px;">
          <div style="font-weight:800;color:var(--blue-dark);font-size:14px;display:flex;align-items:center;gap:6px;">
            ${escHtml(d.nome || 'Sem nome')}
            ${ehAparelhoAtual ? '<span style="background:var(--blue);color:#fff;font-size:10px;padding:1px 6px;border-radius:4px;">ESTE APARELHO</span>' : ''}
          </div>
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

  const nome = document.getElementById('edit-disp-nome')?.value.trim();
  const setor = document.getElementById('edit-disp-setor')?.value;

  if (!nome) {
    showToast('⚠️ Informe um nome para identificar o aparelho!', true);
    return;
  }

  try {
    const res = await fetch(`${API_URL}/admin/dispositivos/${_dispositivoEdicaoId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
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

    // Se editou o próprio dispositivo, atualizar localmente
    if (_dispositivoEdicaoId === _dispositivoAtualId) {
      _dispositivoAtualNome = nome;
      _dispositivoAtualSetor = setor;
      localStorage.setItem('usf_device_nome', nome);
      localStorage.setItem('usf_device_setor', setor);
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
