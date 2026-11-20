// Módulo Frontend — Prévia de Receitas (Hiperdia / Renovação / Odontologia)
window._previaReceitaPendente = null;
window._previaModalDadosAtuais = null;
let _previaImagemAtual = null;
let _previaDadosExtrasAtual = null;
let _previaZoom = 1;
let _previaRot = 0;
let _previaPanX = 0;
let _previaPanY = 0;
let _previaModalPacienteId = null;
let _previaModalStatusAtual = 'pendente';

function atualizarBotaoPreviaReceitaRecepcao() {
  const bar = document.getElementById('recepcao-previa-receita-bar');
  if (!bar) return;
  const setor = document.getElementById('input-setor')?.value || '';
  const tipo = document.getElementById('input-tipo-atendimento')?.value || '';
  const ativoSetor = ['Médico', 'Enfermagem', 'Odontologia'].includes(setor);
  bar.style.display = ativoSetor ? 'flex' : 'none';

  const tiposDestaque = ['Hiperdia', 'Renovação de Receita', 'Renovação de Receita Controlada'];
  bar.classList.toggle('destaque-receita', ativoSetor && tiposDestaque.includes(tipo));

  const pill = document.getElementById('recepcao-previa-anexada-pill');
  const txtPill = document.getElementById('recepcao-previa-anexada-txt');
  const btnCap = document.getElementById('btn-abrir-previa-recepcao');
  if (window._previaReceitaPendente) {
    const p = window._previaReceitaPendente;
    const resumo = p.medicamentos
      ? String(p.medicamentos).slice(0, 36) + (String(p.medicamentos).length > 36 ? '...' : '')
      : (p.imagem_base64 ? 'Foto anexada' : 'Dados preenchidos');
    if (pill) pill.style.display = 'inline-flex';
    if (txtPill) txtPill.textContent = `📄 Prévia anexada: ${resumo}`;
    if (btnCap) btnCap.textContent = '✏️ Editar Prévia';
  } else {
    if (pill) pill.style.display = 'none';
    if (btnCap) btnCap.textContent = '📷 Prévia da Receita (Opcional)';
  }
}

function limparPreviaReceitaPendente() {
  window._previaReceitaPendente = null;
  _previaImagemAtual = null;
  _previaDadosExtrasAtual = null;
  atualizarBotaoPreviaReceitaRecepcao();
}

function abrirModalCapturaReceita() {
  const modal = document.getElementById('modal-captura-receita');
  if (!modal) return;
  const p = window._previaReceitaPendente || {};
  _previaImagemAtual = p.imagem_base64 || null;
  _previaDadosExtrasAtual = p.dados_extras || null;

  const setorAtual = document.getElementById('input-setor')?.value || '';
  const tipoDefault = p.tipo_receita || (setorAtual === 'Odontologia' ? 'odonto' : 'branca');

  document.getElementById('pr-tipo').value = tipoDefault;
  document.getElementById('pr-paciente-nome').value = p.paciente_nome_ocr || document.getElementById('input-nome')?.value || '';
  document.getElementById('pr-paciente-cns').value = p.paciente_cns || '';
  document.getElementById('pr-medicamentos').value = p.medicamentos || '';
  document.getElementById('pr-data-emissao').value = p.data_emissao || '';
  document.getElementById('pr-medico-emitente').value = p.medico_emitente || '';
  document.getElementById('pr-observacoes').value = p.observacoes || '';

  const statusEl = document.getElementById('pr-ocr-status');
  if (statusEl) statusEl.style.display = 'none';

  atualizarPreviewImagemCaptura();
  atualizarSugestaoReceitaLocal();
  modal.classList.add('show');
}

function fecharModalCapturaReceita() {
  document.getElementById('modal-captura-receita')?.classList.remove('show');
}

function atualizarPreviewImagemCaptura() {
  const wrap = document.getElementById('pr-img-preview-wrap');
  const img = document.getElementById('pr-img-preview');
  if (!wrap || !img) return;
  if (_previaImagemAtual) {
    img.src = _previaImagemAtual;
    wrap.style.display = 'flex';
  } else {
    img.src = '';
    wrap.style.display = 'none';
  }
}

function removerFotoCapturaReceita() {
  _previaImagemAtual = null;
  const inp1 = document.getElementById('pr-file-camera');
  const inp2 = document.getElementById('pr-file-upload');
  if (inp1) inp1.value = '';
  if (inp2) inp2.value = '';
  atualizarPreviewImagemCaptura();
}

function comprimirFotoReceita(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
    reader.onload = (ev) => {
      const img = new Image();
      img.onerror = () => resolve(ev.target.result);
      img.onload = () => {
        const MAX = 1150;
        let w = img.width;
        let h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * (MAX / w)); w = MAX; }
          else { w = Math.round(w * (MAX / h)); h = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.76));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function processarImagemReceitaFile(file) {
  if (!file) return;
  const statusEl = document.getElementById('pr-ocr-status');
  try {
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.className = 'pr-status-box loading';
      statusEl.textContent = '🤖 Comprimindo e analisando receita com IA... aguarde alguns segundos.';
    }
    _previaImagemAtual = await comprimirFotoReceita(file);
    atualizarPreviewImagemCaptura();

    const res = await fetch(`${API_URL}/receita-previa/analisar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagem_base64: _previaImagemAtual })
    });
    const data = await res.json();

    if (data.ok && data.ocr) {
      const o = data.ocr;
      if (o.tipo_receita && o.tipo_receita !== 'incerto') {
        document.getElementById('pr-tipo').value = o.tipo_receita;
      }
      if (o.paciente_nome) document.getElementById('pr-paciente-nome').value = o.paciente_nome;
      if (o.paciente_cns) document.getElementById('pr-paciente-cns').value = o.paciente_cns;
      if (o.medicamento) document.getElementById('pr-medicamentos').value = o.medicamento;
      if (o.data_emissao) document.getElementById('pr-data-emissao').value = o.data_emissao;
      if (o.medico_emitente) document.getElementById('pr-medico-emitente').value = o.medico_emitente;
      if (o.observacoes) document.getElementById('pr-observacoes').value = o.observacoes;
      _previaDadosExtrasAtual = o.dados_extras || null;

      if (statusEl) {
        statusEl.className = 'pr-status-box ok';
        statusEl.textContent = `✅ Leitura concluída (confiança: ${o.confianca || 75}%). Confira os dados abaixo antes de anexar.`;
      }
      atualizarSugestaoReceitaLocal(data.classificacao);
    } else {
      if (statusEl) {
        statusEl.className = 'pr-status-box warn';
        statusEl.textContent = `⚠️ ${data.error || 'Leitura automática indisponível — foto anexada! Preencha os dados manualmente se desejar.'}`;
      }
      atualizarSugestaoReceitaLocal();
    }
  } catch (err) {
    if (statusEl) {
      statusEl.className = 'pr-status-box warn';
      statusEl.textContent = '⚠️ Falha ao analisar automaticamente — foto mantida para preenchimento manual.';
    }
  }
}

function atualizarSugestaoReceitaLocal(clfServer) {
  const box = document.getElementById('pr-sugestao-box');
  if (!box) return;
  const tipo = document.getElementById('pr-tipo')?.value || 'branca';
  let filaSug = clfServer?.fila_destino || (tipo === 'azul' ? 'Médico' : tipo === 'odonto' ? 'Odontologia' : 'Médico');
  const validadeTxt = tipo === 'azul' ? '2 meses (Azul)' : '6 meses';

  if (clfServer && clfServer.data_vencimento) {
    const urgMap = {
      vencida: '🔴 Vencida',
      urgente: `🟠 Vence em ${clfServer.dias_restantes}d`,
      normal: `🟢 Válida (${clfServer.dias_restantes}d)`
    };
    const badgeUrg = urgMap[clfServer.urgencia] || '';
    box.innerHTML = `<strong>🤖 Sugestão automática:</strong> Destino indicado: <b>${escapeText(filaSug)}</b> · Validade: ${validadeTxt} · Vencimento: <b>${escapeText(clfServer.data_vencimento)}</b> ${badgeUrg}`;
    box.dataset.filaSugerida = filaSug;
    box.dataset.dataVenc = clfServer.data_vencimento;
    box.dataset.diasRest = clfServer.dias_restantes ?? '';
    box.dataset.urgencia = clfServer.urgencia || 'normal';
    box.style.display = 'block';
  } else {
    box.innerHTML = `<strong>ℹ️ Classificação:</strong> Receita <b>${tipo === 'azul' ? 'Azul (Controle Especial)' : tipo === 'odonto' ? 'Odontológica' : 'Branca (PEC)'}</b> · Validade padrão: ${validadeTxt} · Destino sugerido: <b>${escapeText(filaSug)}</b>`;
    box.dataset.filaSugerida = filaSug;
    box.style.display = 'block';
  }
}

function confirmarPreviaReceitaRecepcao(aplicarSetorSugerido = false) {
  const tipo_receita = document.getElementById('pr-tipo')?.value || 'branca';
  const paciente_nome_ocr = document.getElementById('pr-paciente-nome')?.value.trim() || '';
  const paciente_cns = document.getElementById('pr-paciente-cns')?.value.trim() || '';
  const medicamentos = document.getElementById('pr-medicamentos')?.value.trim() || '';
  const data_emissao = document.getElementById('pr-data-emissao')?.value.trim() || '';
  const medico_emitente = document.getElementById('pr-medico-emitente')?.value.trim() || '';
  const observacoes = document.getElementById('pr-observacoes')?.value.trim() || '';
  const box = document.getElementById('pr-sugestao-box');
  const fila_sugerida = box?.dataset?.filaSugerida || (tipo_receita === 'azul' ? 'Médico' : tipo_receita === 'odonto' ? 'Odontologia' : 'Médico');

  if (!_previaImagemAtual && !medicamentos && !paciente_nome_ocr) {
    showToast('Tire uma foto ou informe ao menos os medicamentos da receita!', true);
    return;
  }

  window._previaReceitaPendente = {
    tipo_receita,
    paciente_nome_ocr: paciente_nome_ocr || null,
    paciente_cns: paciente_cns || null,
    medicamentos: medicamentos || null,
    data_emissao: data_emissao || null,
    medico_emitente: medico_emitente || null,
    observacoes: observacoes || null,
    fila_sugerida,
    imagem_base64: _previaImagemAtual || null,
    dados_extras: _previaDadosExtrasAtual || null
  };

  // Preenche nome do paciente na recepção automaticamente se estiver em branco
  const inpNome = document.getElementById('input-nome');
  if (inpNome && !inpNome.value.trim() && paciente_nome_ocr) {
    inpNome.value = paciente_nome_ocr;
  }

  if (aplicarSetorSugerido && fila_sugerida && typeof selecionarSetorRapidoRecepcao === 'function') {
    selecionarSetorRapidoRecepcao(fila_sugerida);
  }

  // Ajusta tipo de atendimento para renovação controlada se for receita azul e estiver em Consulta
  const selTipoAtend = document.getElementById('input-tipo-atendimento');
  if (selTipoAtend && tipo_receita === 'azul' && selTipoAtend.value === 'Consulta') {
    if ([...selTipoAtend.options].some(o => o.value === 'Renovação de Receita Controlada')) {
      selTipoAtend.value = 'Renovação de Receita Controlada';
    }
  }

  atualizarBotaoPreviaReceitaRecepcao();
  fecharModalCapturaReceita();
  showToast('📄 Prévia da receita anexada ao cadastro! Agora finalize clicando em Cadastrar.');
}

// Paste (Ctrl+V) dentro do modal de captura
document.addEventListener('paste', (e) => {
  const modal = document.getElementById('modal-captura-receita');
  if (!modal || !modal.classList.contains('show')) return;
  const items = e.clipboardData?.items || [];
  for (const item of items) {
    if (item.type && item.type.startsWith('image/')) {
      const f = item.getAsFile();
      if (f) {
        e.preventDefault();
        processarImagemReceitaFile(f);
      }
      break;
    }
  }
});

// ====== BADGES E VISUALIZAÇÃO NO CONSULTÓRIO ======
function renderPreviaReceitaBadgeLinha(p) {
  const pr = p?.previa_receita;
  if (!pr) return '';
  const tipoBadge = pr.tipo_receita === 'azul'
    ? '<span class="previa-pill previa-pill-azul">🔵 Receita Azul</span>'
    : pr.tipo_receita === 'odonto'
      ? '<span class="previa-pill previa-pill-odonto">🦷 Receita Odonto</span>'
      : '<span class="previa-pill previa-pill-branca">⚪ Receita Branca</span>';

  let urgBadge = '';
  if (pr.urgencia === 'vencida') {
    urgBadge = '<span class="previa-pill previa-pill-vencida">🔴 Vencida</span>';
  } else if (pr.urgencia === 'urgente') {
    const dTxt = pr.dias_restantes !== null && pr.dias_restantes !== undefined ? `${pr.dias_restantes}d` : 'logo';
    urgBadge = `<span class="previa-pill previa-pill-urgente">🟠 Vence em ${dTxt}</span>`;
  } else if (pr.data_vencimento) {
    urgBadge = `<span class="previa-pill previa-pill-ok">🟢 Válida até ${escapeText(pr.data_vencimento)}</span>`;
  }

  const revBadge = pr.status_revisao === 'revisada'
    ? '<span class="previa-pill previa-pill-pronta">✅ Receita Pronta</span>'
    : '';

  const medPreview = pr.medicamentos
    ? `<div class="previa-med-resumo">💊 ${escapeText(String(pr.medicamentos).slice(0, 90))}${String(pr.medicamentos).length > 90 ? '...' : ''}</div>`
    : '';

  return `<div class="previa-row-box">${tipoBadge}${urgBadge}${revBadge}${medPreview}</div>`;
}

function renderBotaoPreviaReceitaLinha(p, setor) {
  if (!p?.previa_receita) return '';
  const safeNome = String(p.nome || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
  const pronto = p.previa_receita.status_revisao === 'revisada';
  return `<button class="btn-previa-receita ${pronto ? 'revisada' : ''}" onclick="event.stopPropagation();abrirModalVerPreviaReceita(${p.id},'${safeNome}','${setor}')" title="Ver foto e dados extraídos da receita antes do atendimento">${pronto ? '✅ Prévia' : '👁️ Prévia'}</button>`;
}

async function abrirModalVerPreviaReceita(patientId, nomePaciente, setor) {
  const modal = document.getElementById('modal-ver-previa-receita');
  if (!modal) return;
  _previaModalPacienteId = patientId;
  _previaZoom = 1;
  _previaRot = 0;
  _previaPanX = 0;
  _previaPanY = 0;
  window._previaModalDadosAtuais = { patientId, nomePaciente, setor, previa: null };
  inicializarPanZoomPreviaModal();

  document.getElementById('vp-titulo').textContent = `📄 Prévia da Receita — ${nomePaciente}`;
  document.getElementById('vp-subtitulo').textContent = `Setor: ${setor} · Carregando dados...`;
  document.getElementById('vp-img').src = '';
  document.getElementById('vp-img').style.display = 'none';
  document.getElementById('vp-sem-img').style.display = 'flex';
  document.getElementById('vp-sem-img').textContent = '⏳ Carregando imagem...';
  aplicarTransformImgPrevia();

  const formsBox = document.getElementById('vp-formularios-box');
  if (formsBox) {
    formsBox.style.display = ['Médico', 'Enfermagem', 'Odontologia'].includes(setor) ? 'block' : 'none';
  }
  modal.classList.add('show');

  try {
    const r = await fetch(`${API_URL}/patients/${patientId}/previa-receita`, { cache: 'no-store' });
    if (!r.ok) throw new Error('Prévia não encontrada');
    const pr = await r.json();
    _previaModalStatusAtual = pr.status_revisao || 'pendente';
    window._previaModalDadosAtuais = { patientId, nomePaciente, setor, previa: pr };

    const btnRec = document.getElementById('vp-btn-form-rec');
    const btnEsp = document.getElementById('vp-btn-form-esp');
    if (btnRec && btnEsp) {
      btnEsp.classList.toggle('destaque', pr.tipo_receita === 'azul');
      btnRec.classList.toggle('destaque', pr.tipo_receita !== 'azul');
    }

    document.getElementById('vp-subtitulo').textContent = `Setor: ${setor}${pr.status_revisao === 'revisada' ? ' · ✅ Marcada como pronta' : ' · ⏳ Aguardando revisão'}`;
    document.getElementById('vp-nome-pac').textContent = pr.paciente_nome_ocr || nomePaciente;
    document.getElementById('vp-cns').textContent = pr.paciente_cns || 'Não identificado';
    document.getElementById('vp-tipo').textContent = pr.tipo_receita === 'azul' ? '🔵 Azul (Controle Especial)' : pr.tipo_receita === 'odonto' ? '🦷 Odontológica' : '⚪ Branca (PEC)';
    document.getElementById('vp-emissao').textContent = pr.data_emissao || 'Não informada';
    document.getElementById('vp-vencimento').textContent = pr.data_vencimento
      ? `${pr.data_vencimento}${pr.dias_restantes !== null && pr.dias_restantes !== undefined ? ` (${pr.dias_restantes < 0 ? 'Vencida' : pr.dias_restantes + ' dias'})` : ''}`
      : '—';
    document.getElementById('vp-medico').textContent = pr.medico_emitente || 'Não informado';
    document.getElementById('vp-medicamentos').textContent = pr.medicamentos || 'Nenhum medicamento digitado/extraído';
    document.getElementById('vp-obs').textContent = pr.observacoes || 'Sem observações';

    const imgEl = document.getElementById('vp-img');
    const semImgEl = document.getElementById('vp-sem-img');
    const dlEl = document.getElementById('vp-btn-download');
    if (pr.imagem_base64) {
      imgEl.src = pr.imagem_base64;
      imgEl.style.display = 'block';
      semImgEl.style.display = 'none';
      if (dlEl) { dlEl.href = pr.imagem_base64; dlEl.style.display = 'inline-flex'; }
      aplicarTransformImgPrevia();
    } else {
      imgEl.style.display = 'none';
      semImgEl.style.display = 'flex';
      semImgEl.textContent = '📄 Prévia registrada apenas em texto (sem foto anexada)';
      if (dlEl) dlEl.style.display = 'none';
    }

    const btnRev = document.getElementById('vp-btn-revisar');
    if (btnRev) {
      btnRev.textContent = pr.status_revisao === 'revisada' ? '↩️ Marcar como Pendente' : '✅ Marcar Receita Pronta';
      btnRev.classList.toggle('btn-revisada-ativo', pr.status_revisao === 'revisada');
    }
  } catch (err) {
    document.getElementById('vp-sem-img').textContent = '❌ Não foi possível carregar os dados desta prévia.';
  }
}

function fecharModalVerPreviaReceita() {
  document.getElementById('modal-ver-previa-receita')?.classList.remove('show');
  _previaModalPacienteId = null;
}

function aplicarTransformImgPrevia() {
  const img = document.getElementById('vp-img');
  if (img) {
    img.style.transform = `translate(${_previaPanX}px, ${_previaPanY}px) scale(${_previaZoom}) rotate(${_previaRot}deg)`;
  }
  const lbl = document.getElementById('vp-zoom-label');
  if (lbl) lbl.textContent = `${Math.round(_previaZoom * 100)}%`;
}

function zoomPreviaImg(delta) {
  _previaZoom = Math.max(0.5, Math.min(4.5, Number((_previaZoom + delta).toFixed(2))));
  aplicarTransformImgPrevia();
}

function girarPreviaImg() {
  _previaRot = (_previaRot + 90) % 360;
  aplicarTransformImgPrevia();
}

function resetPreviaImgView() {
  _previaZoom = 1;
  _previaRot = 0;
  _previaPanX = 0;
  _previaPanY = 0;
  aplicarTransformImgPrevia();
}

function initPreviaPanZoom(stageId, imgId, getState, setState, onRender) {
  const stage = document.getElementById(stageId);
  if (!stage || stage.dataset.pzBound === '1') return;
  stage.dataset.pzBound = '1';

  let dragging = false;
  let startX = 0;
  let startY = 0;
  let origPanX = 0;
  let origPanY = 0;

  stage.addEventListener('pointerdown', (e) => {
    const img = document.getElementById(imgId);
    if (!img || img.style.display === 'none') return;
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const st = getState();
    origPanX = st.panX;
    origPanY = st.panY;
    stage.classList.add('grabbing');
    try { stage.setPointerCapture(e.pointerId); } catch (_) {}
  });

  stage.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    setState({ panX: origPanX + (e.clientX - startX), panY: origPanY + (e.clientY - startY) });
    onRender();
  });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    stage.classList.remove('grabbing');
    try {
      if (e && e.pointerId !== undefined) stage.releasePointerCapture(e.pointerId);
    } catch (_) {}
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  stage.addEventListener('wheel', (e) => {
    const img = document.getElementById(imgId);
    if (!img || img.style.display === 'none') return;
    e.preventDefault();
    const st = getState();
    const step = e.deltaY < 0 ? 0.2 : -0.2;
    const nextZoom = Math.max(0.5, Math.min(4.5, Number((st.zoom + step).toFixed(2))));
    setState({ zoom: nextZoom });
    onRender();
  }, { passive: false });

  stage.addEventListener('dblclick', () => {
    setState({ zoom: 1, rot: 0, panX: 0, panY: 0 });
    onRender();
  });
}

function inicializarPanZoomPreviaModal() {
  initPreviaPanZoom(
    'vp-img-stage',
    'vp-img',
    () => ({ zoom: _previaZoom, rot: _previaRot, panX: _previaPanX, panY: _previaPanY }),
    (patch) => {
      if (patch.zoom !== undefined) _previaZoom = patch.zoom;
      if (patch.rot !== undefined) _previaRot = patch.rot;
      if (patch.panX !== undefined) _previaPanX = patch.panX;
      if (patch.panY !== undefined) _previaPanY = patch.panY;
    },
    aplicarTransformImgPrevia
  );
}

window.initPreviaPanZoom = initPreviaPanZoom;
document.addEventListener('DOMContentLoaded', inicializarPanZoomPreviaModal);

function copiarTextoPrevia(elementId, label) {
  const txt = document.getElementById(elementId)?.textContent?.trim() || '';
  if (!txt || txt === 'Não identificado' || txt.startsWith('Nenhum ')) {
    showToast(`Nenhum(a) ${label} disponível para copiar.`, true);
    return;
  }
  navigator.clipboard?.writeText(txt).then(() => {
    showToast(`📋 ${label} copiado para colar no PEC!`);
  }).catch(() => {
    showToast('Não foi possível copiar automaticamente.', true);
  });
}

async function alternarStatusRevisaoPrevia() {
  if (!_previaModalPacienteId) return;
  const novoStatus = _previaModalStatusAtual === 'revisada' ? 'pendente' : 'revisada';
  try {
    const r = await fetch(`${API_URL}/patients/${_previaModalPacienteId}/previa-receita/revisar`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status_revisao: novoStatus })
    });
    if (!r.ok) throw new Error();
    _previaModalStatusAtual = novoStatus;
    const btnRev = document.getElementById('vp-btn-revisar');
    if (btnRev) {
      btnRev.textContent = novoStatus === 'revisada' ? '↩️ Marcar como Pendente' : '✅ Marcar Receita Pronta';
      btnRev.classList.toggle('btn-revisada-ativo', novoStatus === 'revisada');
    }
    showToast(novoStatus === 'revisada' ? '✅ Receita marcada como PRONTA!' : '⏳ Receita voltou para pendente.');
    if (typeof loadQueues === 'function') await loadQueues();
  } catch {
    showToast('Erro ao atualizar status da receita.', true);
  }
}
