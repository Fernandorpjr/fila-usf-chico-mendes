// @ts-nocheck
// Módulo do Histórico de Cancelamentos e Reagendamentos (USF Chico Mendes)

let _historicoDados = [];
let _historicoIdsSelecionados = new Set();
let _chartHistoricoDia = null;
let _chartHistoricoProf = null;
let _chartHistoricoMotivo = null;

// Sanitização segura contra XSS
function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Formatar data no padrão brasileiro
function formatarDataBR(isoDate) {
  if (!isoDate) return '-';
  const raw = String(isoDate).split('T')[0];
  const parts = raw.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return raw;
}

// Inicializar e carregar histórico
async function carregarHistorico() {
  const container = document.getElementById('hist-lista-container');
  const contador = document.getElementById('hist-contador');
  if (!container) return;

  container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--gray-500);"><div class="spinner" style="margin:0 auto 10px;"></div>Carregando histórico...</div>';

  const params = new URLSearchParams();
  const dtInicio = document.getElementById('hist-filtro-inicio')?.value;
  const dtFim = document.getElementById('hist-filtro-fim')?.value;
  const tipo = document.getElementById('hist-filtro-tipo')?.value;
  const prof = document.getElementById('hist-filtro-prof')?.value;
  const equipe = document.getElementById('hist-filtro-equipe')?.value;
  const atend = document.getElementById('hist-filtro-atend')?.value;
  const motivo = document.getElementById('hist-filtro-motivo')?.value;
  const disp = document.getElementById('hist-filtro-dispositivo')?.value;
  const busca = document.getElementById('hist-filtro-busca')?.value;
  const arquivado = document.getElementById('hist-filtro-arquivado')?.value;

  if (dtInicio) params.set('periodo_inicio', dtInicio);
  if (dtFim) params.set('periodo_fim', dtFim);
  if (tipo) params.set('tipo', tipo);
  if (prof) params.set('profissional', prof);
  if (equipe) params.set('equipe', equipe);
  if (atend) params.set('tipo_atendimento', atend);
  if (motivo) params.set('motivo', motivo);
  if (disp) params.set('dispositivo', disp);
  if (busca) params.set('busca', busca.trim());
  if (arquivado) params.set('arquivado', arquivado);

  try {
    const res = await fetch(`${API_URL}/agendamentos/historico?${params.toString()}`);
    if (!res.ok) throw new Error('Falha ao carregar');
    _historicoDados = await res.json();
    _historicoIdsSelecionados.clear();
    atualizarBotaoExclusaoLote();

    if (contador) {
      contador.textContent = `${_historicoDados.length} registro(s) encontrado(s)`;
    }

    renderizarHistorico(_historicoDados, container);
    carregarResumoHistorico(dtInicio, dtFim);
  } catch (err) {
    console.error('Erro ao carregar histórico:', err);
    container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--red);">Erro ao carregar os dados do histórico.</div>';
  }
}

// Renderização híbrida: Tabela no desktop e Cards no celular
function renderizarHistorico(lista, container) {
  if (!lista || lista.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:40px 20px;color:var(--gray-500);background:#fff;border-radius:12px;border:1px dashed var(--gray-300);">
        <div style="font-size:32px;margin-bottom:8px;">📋</div>
        <div style="font-weight:700;font-size:15px;color:var(--gray-700);">Nenhum registro encontrado</div>
        <div style="font-size:13px;margin-top:4px;">Tente ajustar ou limpar os filtros de busca.</div>
      </div>
    `;
    return;
  }

  // Montar tabela desktop
  let rowsHtml = lista.map(item => {
    const isCancelado = item.novo_status === 'cancelado';
    const statusBadge = isCancelado
      ? '<span class="status-badge cancelado" style="background:#fee2e2;color:#991b1b;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:800;">❌ Cancelado</span>'
      : '<span class="status-badge reagendado" style="background:#fef3c7;color:#92400e;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:800;">🔄 Reagendado</span>';

    const dataOriginalFmt = formatarDataBR(item.data_anterior);
    const dataNovaFmt = item.nova_data ? formatarDataBR(item.nova_data) : '-';
    const horarioOriginal = escHtml(item.horario_anterior || '-');
    const horarioNovo = escHtml(item.novo_horario || '-');

    const dtCriado = item.criado_em 
      ? new Date(item.criado_em).toLocaleString('pt-BR', { timeZone: 'America/Recife', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) 
      : '-';

    const loteTag = item.em_lote ? '<span style="background:#ffedd5;color:#9a3412;font-size:10px;font-weight:800;padding:2px 5px;border-radius:4px;margin-left:4px;">LOTE</span>' : '';
    const arqTag = item.arquivado ? '<span style="background:#e5e7eb;color:#374151;font-size:10px;font-weight:800;padding:2px 5px;border-radius:4px;margin-left:4px;">ARQUIVADO</span>' : '';

    return `
      <tr class="hist-row" id="hist-row-${item.id}" style="border-bottom:1px solid var(--gray-200);">
        <td style="padding:10px 8px;text-align:center;">
          <input type="checkbox" class="hist-check-item" value="${item.id}" onchange="toggleSelecionarItemHistorico(${item.id}, this.checked)">
        </td>
        <td style="padding:10px 8px;">
          <div style="font-weight:800;color:var(--blue-dark);font-size:13px;">${escHtml(item.paciente)}</div>
          <div style="font-size:11px;color:var(--gray-600);">${escHtml(item.telefone || '-')}</div>
        </td>
        <td style="padding:10px 8px;">
          <div style="font-weight:700;font-size:12px;">${escHtml(item.tipo_atendimento || 'Consulta')}</div>
          <div style="font-size:11px;color:var(--gray-600);">${escHtml(item.profissional || '-')}</div>
          <div style="font-size:10px;color:#0284c7;font-weight:700;">${escHtml(item.equipe || 'Sem equipe')}</div>
        </td>
        <td style="padding:10px 8px;text-align:center;">
          ${statusBadge}${loteTag}${arqTag}
        </td>
        <td style="padding:10px 8px;font-size:12px;">
          <div><b>Original:</b> ${dataOriginalFmt} às ${horarioOriginal}</div>
          ${item.novo_status === 'reagendado' ? `<div style="color:#059669;font-weight:700;margin-top:2px;"><b>Nova:</b> ${dataNovaFmt} às ${horarioNovo}</div>` : ''}
        </td>
        <td style="padding:10px 8px;font-size:12px;">
          <div style="color:var(--gray-800);">${escHtml(item.motivo || 'Não informado')}</div>
          <div style="font-size:10px;color:var(--gray-500);margin-top:2px;">Dispositivo: <b>${escHtml(item.dispositivo_nome || 'Sem nome')}</b> (${escHtml(item.usuario || '-')})</div>
          <div style="font-size:10px;color:var(--gray-400);">Em: ${dtCriado}</div>
        </td>
        <td style="padding:10px 8px;text-align:center;">
          <label style="cursor:pointer;font-size:11px;display:inline-flex;align-items:center;gap:4px;user-select:none;">
            <input type="checkbox" ${item.vaga_reaproveitada ? 'checked' : ''} onchange="alternarVagaReaproveitada(${item.id}, this.checked)">
            <span style="font-weight:700;color:${item.vaga_reaproveitada ? '#15803d' : '#6b7280'};">${item.vaga_reaproveitada ? 'Sim' : 'Não'}</span>
          </label>
        </td>
        <td style="padding:10px 8px;text-align:center;">
          <button class="btn btn-outline btn-sm" onclick="abrirModalExcluirIndividual(${item.id}, '${escHtml(item.paciente)}')" title="Excluir do Histórico" style="color:var(--red);border-color:#fca5a5;padding:4px 8px;font-size:12px;">
            🗑️
          </button>
        </td>
      </tr>
    `;
  }).join('');

  // Montar cards mobile
  let cardsHtml = lista.map(item => {
    const isCancelado = item.novo_status === 'cancelado';
    const statusText = isCancelado ? '❌ Cancelado' : '🔄 Reagendado';
    const borderCor = isCancelado ? '#ef4444' : '#f59e0b';
    const dataOriginalFmt = formatarDataBR(item.data_anterior);
    const dataNovaFmt = item.nova_data ? formatarDataBR(item.nova_data) : '-';

    return `
      <div class="hist-card-mobile" style="background:#fff;border-radius:10px;border-left:5px solid ${borderCor};padding:12px;margin-bottom:10px;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
          <div>
            <div style="font-weight:800;font-size:14px;color:var(--blue-dark);">${escHtml(item.paciente)}</div>
            <div style="font-size:12px;color:var(--gray-600);">${escHtml(item.telefone || '-')} • ${escHtml(item.equipe || 'Sem equipe')}</div>
          </div>
          <span style="font-size:11px;font-weight:800;padding:2px 8px;border-radius:6px;background:${isCancelado ? '#fee2e2' : '#fef3c7'};color:${isCancelado ? '#991b1b' : '#92400e'};">
            ${statusText}
          </span>
        </div>

        <div style="font-size:12px;color:var(--gray-700);margin-bottom:6px;">
          <div><b>Profissional:</b> ${escHtml(item.profissional || '-')} (${escHtml(item.tipo_atendimento || 'Consulta')})</div>
          <div><b>Original:</b> ${dataOriginalFmt} às ${escHtml(item.horario_anterior || '-')}</div>
          ${item.novo_status === 'reagendado' ? `<div style="color:#059669;font-weight:700;"><b>Nova Data:</b> ${dataNovaFmt} às ${escHtml(item.novo_horario || '-')}</div>` : ''}
          <div style="margin-top:4px;"><b>Motivo:</b> ${escHtml(item.motivo || 'Não informado')}</div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;padding-top:8px;border-top:1px solid var(--gray-100);font-size:11px;">
          <label style="cursor:pointer;display:inline-flex;align-items:center;gap:4px;">
            <input type="checkbox" ${item.vaga_reaproveitada ? 'checked' : ''} onchange="alternarVagaReaproveitada(${item.id}, this.checked)">
            <span>Vaga reaproveitada? <b>${item.vaga_reaproveitada ? 'Sim' : 'Não'}</b></span>
          </label>
          <button class="btn btn-outline btn-sm" onclick="abrirModalExcluirIndividual(${item.id}, '${escHtml(item.paciente)}')" style="color:var(--red);border-color:#fca5a5;padding:3px 8px;font-size:11px;">
            🗑️ Excluir
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <!-- Tabela Desktop -->
    <div class="hist-desktop-view" style="overflow-x:auto;">
      <table class="agend-table" style="width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;">
        <thead>
          <tr style="background:var(--blue);color:white;">
            <th style="width:36px;text-align:center;padding:10px 8px;">
              <input type="checkbox" id="hist-check-all" onchange="toggleSelecionarTodosHistorico(this.checked)" title="Selecionar Todos">
            </th>
            <th style="padding:10px 8px;text-align:left;">Paciente</th>
            <th style="padding:10px 8px;text-align:left;">Atendimento / Equipe</th>
            <th style="padding:10px 8px;text-align:center;">Status</th>
            <th style="padding:10px 8px;text-align:left;">Data Consulta</th>
            <th style="padding:10px 8px;text-align:left;">Motivo & Dispositivo</th>
            <th style="padding:10px 8px;text-align:center;">Vaga Reaproveitada?</th>
            <th style="padding:10px 8px;text-align:center;width:60px;">Ação</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>

    <!-- Cards Mobile -->
    <div class="hist-mobile-view" style="display:none;">
      ${cardsHtml}
    </div>
  `;
}

// Alternar status de vaga reaproveitada
async function alternarVagaReaproveitada(id, status) {
  try {
    const res = await fetch(`${API_URL}/agendamentos/historico/${id}/vaga`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vaga_reaproveitada: status })
    });
    if (!res.ok) throw new Error();
    showToast(status ? '✅ Vaga marcada como reaproveitada!' : 'ℹ️ Vaga desmarcada');
    const dtInicio = document.getElementById('hist-filtro-inicio')?.value;
    const dtFim = document.getElementById('hist-filtro-fim')?.value;
    carregarResumoHistorico(dtInicio, dtFim);
  } catch (err) {
    showToast('Erro ao atualizar status da vaga', true);
  }
}

// Seleção em lote
function toggleSelecionarTodosHistorico(checked) {
  const checkboxes = document.querySelectorAll('.hist-check-item');
  checkboxes.forEach(cb => {
    cb.checked = checked;
    const id = parseInt(cb.value, 10);
    if (checked) _historicoIdsSelecionados.add(id);
    else _historicoIdsSelecionados.delete(id);
  });
  atualizarBotaoExclusaoLote();
}

function toggleSelecionarItemHistorico(id, checked) {
  if (checked) _historicoIdsSelecionados.add(id);
  else _historicoIdsSelecionados.delete(id);

  const checkAll = document.getElementById('hist-check-all');
  if (checkAll) {
    checkAll.checked = _historicoIdsSelecionados.size === _historicoDados.length && _historicoDados.length > 0;
  }
  atualizarBotaoExclusaoLote();
}

function atualizarBotaoExclusaoLote() {
  const btn = document.getElementById('hist-btn-excluir-lote');
  if (!btn) return;
  const count = _historicoIdsSelecionados.size;
  if (count > 0) {
    btn.style.display = 'inline-flex';
    btn.textContent = `🗑️ Excluir Selecionados (${count})`;
  } else {
    btn.style.display = 'none';
  }
}

// Limpar todos os filtros
function limparFiltrosHistorico() {
  ['hist-filtro-inicio', 'hist-filtro-fim', 'hist-filtro-tipo', 'hist-filtro-prof', 'hist-filtro-equipe', 'hist-filtro-atend', 'hist-filtro-motivo', 'hist-filtro-dispositivo', 'hist-filtro-busca'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const arqEl = document.getElementById('hist-filtro-arquivado');
  if (arqEl) arqEl.value = 'false';
  carregarHistorico();
}

// Exportar CSV
function exportarCsvHistorico() {
  window.open(`${API_URL}/agendamentos/historico/csv`, '_blank');
}

// Modal de Exclusão Individual / Em Lote
let _exclusaoAlvoIds = [];

function abrirModalExcluirIndividual(id, paciente) {
  _exclusaoAlvoIds = [id];
  const modal = document.getElementById('modal-excluir-historico');
  const txt = document.getElementById('modal-excluir-hist-texto');
  const senhaInp = document.getElementById('modal-excluir-hist-senha');
  if (txt) txt.textContent = `Tem certeza de que deseja excluir permanentemente o registro de histórico do paciente "${paciente}"?`;
  if (senhaInp) { senhaInp.value = ''; senhaInp.focus(); }
  if (modal) modal.classList.add('show');
}

function abrirModalExcluirLote() {
  if (_historicoIdsSelecionados.size === 0) return;
  _exclusaoAlvoIds = Array.from(_historicoIdsSelecionados);
  const modal = document.getElementById('modal-excluir-historico');
  const txt = document.getElementById('modal-excluir-hist-texto');
  const senhaInp = document.getElementById('modal-excluir-hist-senha');
  if (txt) txt.textContent = `Tem certeza de que deseja excluir permanentemente os ${_exclusaoAlvoIds.length} registros selecionados?`;
  if (senhaInp) { senhaInp.value = ''; senhaInp.focus(); }
  if (modal) modal.classList.add('show');
}

function fecharModalExcluirHistorico() {
  const modal = document.getElementById('modal-excluir-historico');
  if (modal) modal.classList.remove('show');
  _exclusaoAlvoIds = [];
}

async function confirmarExclusaoHistorico() {
  const senhaInp = document.getElementById('modal-excluir-hist-senha');
  const senha = senhaInp ? senhaInp.value.trim() : '';

  if (!senha) {
    showToast('⚠️ Digite a senha administrativa!', true);
    return;
  }
  if (_exclusaoAlvoIds.length === 0) {
    fecharModalExcluirHistorico();
    return;
  }

  try {
    const res = await fetch(`${API_URL}/agendamentos/historico/excluir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senha, ids: _exclusaoAlvoIds })
    });

    if (res.status === 403) {
      showToast('❌ Senha administrativa incorreta!', true);
      senhaInp.value = '';
      senhaInp.focus();
      return;
    }
    if (!res.ok) throw new Error('Falha na exclusão');

    const data = await res.json();
    showToast(`✅ ${data.deletados || _exclusaoAlvoIds.length} registro(s) excluído(s) com sucesso!`);
    fecharModalExcluirHistorico();
    carregarHistorico();
  } catch (err) {
    showToast('Erro ao excluir registros!', true);
  }
}

// Carregar Resumo Agregado e Gráficos (Chart.js)
async function carregarResumoHistorico(inicio, fim) {
  const params = new URLSearchParams();
  if (inicio) params.set('periodo_inicio', inicio);
  if (fim) params.set('periodo_fim', fim);

  try {
    const res = await fetch(`${API_URL}/agendamentos/historico/resumo?${params.toString()}`);
    if (!res.ok) return;
    const data = await res.json();

    // Atualizar cards de totais
    const totais = data.totais || {};
    const elCanc = document.getElementById('hist-card-total-canc');
    const elReag = document.getElementById('hist-card-total-reag');
    const elVagas = document.getElementById('hist-card-total-vagas');
    const elAlerta = document.getElementById('hist-card-alerta-reaproveitamento');

    if (elCanc) elCanc.textContent = totais.total_cancelados || 0;
    if (elReag) elReag.textContent = totais.total_reagendados || 0;
    if (elVagas) elVagas.textContent = totais.total_vagas_reaproveitadas || 0;

    if (elAlerta) {
      const semReaproveitar = parseInt(totais.cancelados_sem_nova_data || 0, 10);
      if (semReaproveitar > 0) {
        elAlerta.style.display = 'block';
        elAlerta.innerHTML = `⚠️ <b>Atenção:</b> Existem <b>${semReaproveitar}</b> cancelamento(s) com vaga ainda não reaproveitada.`;
      } else {
        elAlerta.style.display = 'none';
      }
    }

    // Renderizar Gráficos se Chart.js estiver disponível
    if (window.Chart) {
      renderizarGraficosHistorico(data);
    }
  } catch (err) {
    console.error('Erro ao carregar resumo:', err);
  }
}

function renderizarGraficosHistorico(data) {
  // 1. Gráfico por Dia
  const ctxDia = document.getElementById('chart-hist-dia')?.getContext('2d');
  if (ctxDia) {
    if (_chartHistoricoDia) _chartHistoricoDia.destroy();
    const dias = (data.porDia || []).map(d => formatarDataBR(d.dia));
    const canc = (data.porDia || []).map(d => parseInt(d.cancelados || 0, 10));
    const reag = (data.porDia || []).map(d => parseInt(d.reagendados || 0, 10));

    _chartHistoricoDia = new Chart(ctxDia, {
      type: 'bar',
      data: {
        labels: dias,
        datasets: [
          { label: 'Cancelados', data: canc, backgroundColor: '#ef4444' },
          { label: 'Reagendados', data: reag, backgroundColor: '#f59e0b' }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { stacked: true },
          y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } }
        }
      }
    });
  }

  // 2. Gráfico por Profissional
  const ctxProf = document.getElementById('chart-hist-prof')?.getContext('2d');
  if (ctxProf) {
    if (_chartHistoricoProf) _chartHistoricoProf.destroy();
    const profs = (data.porProfissional || []).map(p => p.profissional);
    const totaisProf = (data.porProfissional || []).map(p => parseInt(p.total || 0, 10));

    _chartHistoricoProf = new Chart(ctxProf, {
      type: 'bar',
      data: {
        labels: profs,
        datasets: [
          { label: 'Ocorrências', data: totaisProf, backgroundColor: '#1a4fc4' }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        scales: {
          x: { beginAtZero: true, ticks: { precision: 0 } }
        }
      }
    });
  }

  // 3. Gráfico por Motivo
  const ctxMotivo = document.getElementById('chart-hist-motivo')?.getContext('2d');
  if (ctxMotivo) {
    if (_chartHistoricoMotivo) _chartHistoricoMotivo.destroy();
    const motivos = (data.porMotivo || []).map(m => m.motivo);
    const totaisMotivo = (data.porMotivo || []).map(m => parseInt(m.total || 0, 10));

    _chartHistoricoMotivo = new Chart(ctxMotivo, {
      type: 'doughnut',
      data: {
        labels: motivos,
        datasets: [{
          data: totaisMotivo,
          backgroundColor: ['#ef4444', '#f59e0b', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899', '#6b7280', '#06b6d4']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false
      }
    });
  }
}

// Impressão A4 estilizada do histórico
function imprimirHistorico() {
  const container = document.getElementById('hist-print-area');
  if (!container) return;

  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Recife' });
  const dtInicio = document.getElementById('hist-filtro-inicio')?.value;
  const dtFim = document.getElementById('hist-filtro-fim')?.value;
  const tipo = document.getElementById('hist-filtro-tipo')?.value;
  const prof = document.getElementById('hist-filtro-prof')?.value;

  let filtrosTexto = [];
  if (dtInicio || dtFim) filtrosTexto.push(`Período: ${formatarDataBR(dtInicio) || 'início'} até ${formatarDataBR(dtFim) || 'atual'}`);
  if (tipo) filtrosTexto.push(`Tipo: ${tipo.toUpperCase()}`);
  if (prof) filtrosTexto.push(`Profissional: ${prof}`);
  const filtrosInfo = filtrosTexto.length > 0 ? filtrosTexto.join(' | ') : 'Todos os registros ativos';

  let linhasPrint = _historicoDados.map((item, idx) => {
    const isCanc = item.novo_status === 'cancelado';
    const statusLabel = isCanc ? 'Cancelado' : 'Reagendado';
    const badgeClass = isCanc ? 'badge-cancelado' : 'badge-reagendado';
    const dtOriginal = formatarDataBR(item.data_anterior);
    const dtNova = item.nova_data ? formatarDataBR(item.nova_data) : '-';

    return `
      <tr>
        <td style="text-align:center;">${idx + 1}</td>
        <td><b>${escHtml(item.paciente)}</b><br><span style="font-size:7.5pt;color:#4b5563;">${escHtml(item.telefone || '-')}</span></td>
        <td>${escHtml(item.tipo_atendimento || 'Consulta')}<br><span style="font-size:7.5pt;">${escHtml(item.profissional || '-')}</span></td>
        <td style="text-align:center;"><span class="badge-print ${badgeClass}">${statusLabel}</span></td>
        <td>Orig: ${dtOriginal} ${item.horario_anterior || ''}<br>${item.novo_status === 'reagendado' ? `Nova: ${dtNova} ${item.novo_horario || ''}` : ''}</td>
        <td>${escHtml(item.motivo || '-')}<br><span style="font-size:7pt;color:#6b7280;">Disp: ${escHtml(item.dispositivo_nome || 'Sem nome')}</span></td>
        <td style="text-align:center;">${item.vaga_reaproveitada ? 'Sim' : 'Não'}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div class="print-header">
      <h1>USF Chico Mendes — Histórico de Cancelamentos e Reagendamentos</h1>
      <p class="print-sub">Unidade de Saúde da Família Chico Mendes • Sistema de Gestão de Filas e Consultas</p>
      <div class="print-meta">
        <b>Filtros aplicados:</b> ${escHtml(filtrosInfo)} | <b>Total de registros:</b> ${_historicoDados.length} | <b>Emitido em:</b> ${agora} (Fuso Recife)
      </div>
    </div>
    <table class="print-table">
      <thead>
        <tr>
          <th style="width:25px;text-align:center;">Nº</th>
          <th>Paciente</th>
          <th>Atendimento / Profissional</th>
          <th style="text-align:center;">Status</th>
          <th>Datas</th>
          <th>Motivo & Dispositivo</th>
          <th style="text-align:center;">Vaga Reapr.?</th>
        </tr>
      </thead>
      <tbody>
        ${linhasPrint}
      </tbody>
    </table>
  `;

  // Marcar tela ativa de print
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('print-active'));
  document.getElementById('screen-agendamentos')?.classList.add('print-active');

  window.print();
}

// Configuração de retenção (N dias)
async function abrirModalConfigRetencao() {
  const modal = document.getElementById('modal-config-retencao');
  const inpDias = document.getElementById('config-retencao-dias');
  const inpSenha = document.getElementById('config-retencao-senha');
  if (inpSenha) inpSenha.value = '';

  try {
    const res = await fetch(`${API_URL}/admin/config/retencao`);
    if (res.ok) {
      const data = await res.json();
      if (inpDias) inpDias.value = data.retencao_dias || 30;
    }
  } catch (e) {}

  if (modal) modal.classList.add('show');
}

function fecharModalConfigRetencao() {
  const modal = document.getElementById('modal-config-retencao');
  if (modal) modal.classList.remove('show');
}

async function salvarConfigRetencao() {
  const dias = document.getElementById('config-retencao-dias')?.value;
  const senha = document.getElementById('config-retencao-senha')?.value;

  if (!dias || isNaN(dias) || dias < 1) {
    showToast('⚠️ Informe um número válido de dias (mínimo 1)!', true);
    return;
  }
  if (!senha) {
    showToast('⚠️ Informe a senha administrativa!', true);
    return;
  }

  try {
    const res = await fetch(`${API_URL}/admin/config/retencao`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senha, retencao_dias: parseInt(dias, 10) })
    });

    if (res.status === 403) {
      showToast('❌ Senha administrativa incorreta!', true);
      return;
    }
    if (!res.ok) throw new Error();

    showToast(`✅ Prazo de retenção atualizado para ${dias} dias!`);
    fecharModalConfigRetencao();
  } catch (e) {
    showToast('Erro ao salvar configuração!', true);
  }
}
