// Módulo Frontend — Prévia de Receitas e Encaminhamentos (até 6 anexos por paciente)
const MAX_ANEXOS_CAPTURA = 6;
const CATEGORIAS_ANEXO_LABEL = {
  receita_branca: '⚪ Receita Branca',
  receita_azul: '🔵 Receita Azul',
  odonto: '🦷 Odonto',
  encaminhamento: '📋 Encaminhamento',
  exame: '🧪 Exame/Outro'
};

window._previaReceitaPendente = null;
window._previaModalDadosAtuais = null;

let _previaAnexosCaptura = [];
let _previaDadosExtrasAtual = null;
let _previaZoom = 1;
let _previaRot = 0;
let _previaPanX = 0;
let _previaPanY = 0;
let _previaModalPacienteId = null;
let _previaModalStatusAtual = 'pendente';
let _previaModalAnexos = [];
let _previaModalFotoIdx = 0;

function escSafe(v) {
  if (typeof escapeText === 'function') return escapeText(v);
  return String(v || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function normStrPrevia(v) {
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function normalizarCategoriaAnexoFront(v) {
  const s = normStrPrevia(v);
  if (s === 'receita_azul' || s === 'azul' || s.includes('azul') || s.includes('controlad')) return 'receita_azul';
  if (s === 'odonto' || s.includes('odonto')) return 'odonto';
  if (s === 'encaminhamento' || s.includes('encaminha') || s.includes('ambulatorial')) return 'encaminhamento';
  if (s === 'exame' || s.includes('exame') || s.includes('laudo')) return 'exame';
  return 'receita_branca';
}

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
    const qtd = Array.isArray(p.anexos) ? p.anexos.length : (p.imagem_base64 ? 1 : 0);
    const medResumo = p.medicamentos
      ? String(p.medicamentos).slice(0, 32) + (String(p.medicamentos).length > 32 ? '...' : '')
      : 'Dados preenchidos';
    const prefixo = qtd > 1 ? `📎 ${qtd} fotos anexadas` : (qtd === 1 ? '📷 1 foto anexada' : '📄 Prévia');
    if (pill) pill.style.display = 'inline-flex';
    if (txtPill) txtPill.textContent = `${prefixo}${p.medicamentos ? ': ' + medResumo : ''}`;
    if (btnCap) btnCap.textContent = qtd > 0 ? `✏️ Editar Prévia (${qtd} foto${qtd > 1 ? 's' : ''})` : '✏️ Editar Prévia';
  } else {
    if (pill) pill.style.display = 'none';
    if (btnCap) btnCap.textContent = '📷 Prévia Receita / Encam. (Opcional)';
  }
}

function limparPreviaReceitaPendente() {
  window._previaReceitaPendente = null;
  _previaAnexosCaptura = [];
  _previaDadosExtrasAtual = null;
  atualizarBotaoPreviaReceitaRecepcao();
}

function abrirModalCapturaReceita() {
  const modal = document.getElementById('modal-captura-receita');
  if (!modal) return;
  const p = window._previaReceitaPendente || {};
  if (Array.isArray(p.anexos) && p.anexos.length > 0) {
    _previaAnexosCaptura = p.anexos.map(a => ({ ...a }));
  } else if (p.imagem_base64) {
    _previaAnexosCaptura = [{
      id: 'anx_1',
      categoria: normalizarCategoriaAnexoFront(p.tipo_receita),
      rotulo: null,
      imagem_base64: p.imagem_base64,
      ocr: null
    }];
  } else {
    _previaAnexosCaptura = [];
  }
  _previaDadosExtrasAtual = p.dados_extras ? { ...p.dados_extras } : null;

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

  renderGaleriaCapturaReceita();
  atualizarSugestaoReceitaLocal();
  modal.classList.add('show');
}

function fecharModalCapturaReceita() {
  document.getElementById('modal-captura-receita')?.classList.remove('show');
}

function renderGaleriaCapturaReceita() {
  const wrap = document.getElementById('pr-galeria-wrap');
  const grid = document.getElementById('pr-galeria-grid');
  const cntEl = document.getElementById('pr-galeria-count');
  if (!wrap || !grid) return;

  if (_previaAnexosCaptura.length === 0) {
    wrap.style.display = 'none';
    grid.innerHTML = '';
    return;
  }

  wrap.style.display = 'block';
  if (cntEl) {
    cntEl.textContent = `📎 ${_previaAnexosCaptura.length} / ${MAX_ANEXOS_CAPTURA} fotos anexadas`;
  }

  const optsHtml = (sel) => Object.entries(CATEGORIAS_ANEXO_LABEL)
    .map(([k, lab]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${lab}</option>`)
    .join('');

  grid.innerHTML = _previaAnexosCaptura.map((anx, idx) => `
    <div class="pr-thumb-card">
      <button type="button" class="pr-thumb-rm" onclick="removerFotoCapturaReceita(${idx})" title="Remover esta foto">✕</button>
      <img src="${anx.imagem_base64}" alt="Anexo ${idx + 1}" class="pr-thumb-img">
      <select class="pr-thumb-cat" onchange="alterarCategoriaAnexoCaptura(${idx}, this.value)">
        ${optsHtml(normalizarCategoriaAnexoFront(anx.categoria))}
      </select>
    </div>
  `).join('');
}

function alterarCategoriaAnexoCaptura(idx, val) {
  if (!_previaAnexosCaptura[idx]) return;
  _previaAnexosCaptura[idx].categoria = normalizarCategoriaAnexoFront(val);
  atualizarTipoGlobalPorAnexos();
}

function removerFotoCapturaReceita(idx) {
  _previaAnexosCaptura.splice(idx, 1);
  renderGaleriaCapturaReceita();
  atualizarTipoGlobalPorAnexos();
}

function limparTodasFotosCaptura() {
  _previaAnexosCaptura = [];
  const inp1 = document.getElementById('pr-file-camera');
  const inp2 = document.getElementById('pr-file-upload');
  if (inp1) inp1.value = '';
  if (inp2) inp2.value = '';
  renderGaleriaCapturaReceita();
}

function atualizarTipoGlobalPorAnexos() {
  const sel = document.getElementById('pr-tipo');
  if (!sel || _previaAnexosCaptura.length === 0) {
    atualizarSugestaoReceitaLocal();
    return;
  }
  const cats = _previaAnexosCaptura.map(a => a.categoria);
  if (cats.includes('receita_azul')) sel.value = 'azul';
  else if (cats.includes('odonto') && sel.value !== 'azul') sel.value = 'odonto';
  atualizarSugestaoReceitaLocal();
}

function comprimirFotoReceita(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
    reader.onload = (ev) => {
      const img = new Image();
      img.onerror = () => resolve(ev.target.result);
      img.onload = () => {
        const MAX = 1050;
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
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function mesclarTextoListaDeduplicado(atual, novo) {
  const itensAtuais = String(atual || '').split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
  const novosItens = String(novo || '').split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
  const vistos = new Set(itensAtuais.map(normStrPrevia));
  for (const it of novosItens) {
    const k = normStrPrevia(it);
    if (!k || vistos.has(k)) continue;
    vistos.add(k);
    itensAtuais.push(it);
  }
  return itensAtuais.join(', ');
}

function mesclarOcrNoFormularioCaptura(o) {
  if (!o || typeof o !== 'object') return;
  const setIfBlank = (id, val) => {
    const el = document.getElementById(id);
    if (el && !el.value.trim() && val) el.value = String(val).trim();
  };
  setIfBlank('pr-paciente-nome', o.paciente_nome);
  setIfBlank('pr-paciente-cns', o.paciente_cns);
  setIfBlank('pr-data-emissao', o.data_emissao);
  setIfBlank('pr-medico-emitente', o.medico_emitente);

  if (o.medicamento) {
    const medEl = document.getElementById('pr-medicamentos');
    if (medEl) medEl.value = mesclarTextoListaDeduplicado(medEl.value, o.medicamento);
  }
  if (o.observacoes) {
    const obsEl = document.getElementById('pr-observacoes');
    if (obsEl) {
      const atual = obsEl.value.trim();
      const novo = String(o.observacoes).trim();
      if (!atual) obsEl.value = novo;
      else if (!normStrPrevia(atual).includes(normStrPrevia(novo))) obsEl.value = `${atual} · ${novo}`;
    }
  }

  const ext = o.dados_extras && typeof o.dados_extras === 'object' ? o.dados_extras : {};
  const merged = { ...(_previaDadosExtrasAtual || {}) };
  ['paciente_endereco', 'paciente_data_nascimento', 'paciente_sexo', 'paciente_telefone', 'paciente_mae', 'especialidade', 'hipotese_diagnostica', 'cid10'].forEach(k => {
    if (!merged[k] && ext[k]) merged[k] = ext[k];
  });
  if (ext.medicamentos_posologia) {
    const posNovo = String(ext.medicamentos_posologia).trim();
    if (!merged.medicamentos_posologia) merged.medicamentos_posologia = posNovo;
    else if (!normStrPrevia(merged.medicamentos_posologia).includes(normStrPrevia(posNovo))) {
      merged.medicamentos_posologia = `${merged.medicamentos_posologia}\n${posNovo}`;
    }
  }
  if (ext.justificativa) {
    const jNovo = String(ext.justificativa).trim();
    if (!merged.justificativa) merged.justificativa = jNovo;
    else if (!normStrPrevia(merged.justificativa).includes(normStrPrevia(jNovo))) {
      merged.justificativa = `${merged.justificativa}\n${jNovo}`;
    }
  }
  _previaDadosExtrasAtual = Object.values(merged).some(Boolean) ? merged : null;
}

async function processarListaImagensReceita(fileList) {
  const files = Array.from(fileList || []).filter(f => f && (!f.type || f.type.startsWith('image/')));
  if (files.length === 0) return;

  const vagas = MAX_ANEXOS_CAPTURA - _previaAnexosCaptura.length;
  if (vagas <= 0) {
    showToast(`Limite máximo de ${MAX_ANEXOS_CAPTURA} fotos atingido para este paciente.`, true);
    return;
  }

  const selecionados = files.slice(0, vagas);
  if (files.length > vagas) {
    showToast(`Foram adicionadas ${vagas} fotos (limite de ${MAX_ANEXOS_CAPTURA} por paciente).`, true);
  }

  const statusEl = document.getElementById('pr-ocr-status');
  const tipoAtual = document.getElementById('pr-tipo')?.value || 'branca';
  let ultimaClf = null;
  let falhasOcr = 0;
  let ultimaMsgErro = '';

  for (let i = 0; i < selecionados.length; i++) {
    const file = selecionados[i];
    try {
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.className = 'pr-status-box loading';
        statusEl.textContent = selecionados.length > 1
          ? `🤖 Comprimindo e analisando foto ${i + 1} de ${selecionados.length} com IA...`
          : '🤖 Comprimindo e analisando documento com IA... aguarde alguns segundos.';
      }

      const b64 = await comprimirFotoReceita(file);
      const novoAnexo = {
        id: `anx_${Date.now().toString(36)}_${i + 1}`,
        categoria: normalizarCategoriaAnexoFront(tipoAtual),
        rotulo: null,
        imagem_base64: b64,
        ocr: null
      };
      _previaAnexosCaptura.push(novoAnexo);
      const idxAtual = _previaAnexosCaptura.length - 1;
      renderGaleriaCapturaReceita();

      const res = await fetch(`${API_URL}/receita-previa/analisar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagem_base64: b64 })
      });
      const data = await res.json();

      if (data.ok && data.ocr) {
        const o = data.ocr;
        const cat = normalizarCategoriaAnexoFront(o.tipo_documento || o.tipo_receita);
        _previaAnexosCaptura[idxAtual].categoria = cat;
        _previaAnexosCaptura[idxAtual].ocr = {
          tipo_receita: o.tipo_receita || null,
          tipo_documento: cat,
          medicamento: o.medicamento || null,
          medicamentos_posologia: o.dados_extras?.medicamentos_posologia || null,
          data_emissao: o.data_emissao || null,
          observacoes: o.observacoes || null,
          especialidade: o.dados_extras?.especialidade || null,
          hipotese_diagnostica: o.dados_extras?.hipotese_diagnostica || null,
          cid10: o.dados_extras?.cid10 || null,
          justificativa: o.dados_extras?.justificativa || null
        };
        if (o.dados_extras?.especialidade) {
          _previaAnexosCaptura[idxAtual].rotulo = String(o.dados_extras.especialidade).slice(0, 40);
        }
        mesclarOcrNoFormularioCaptura(o);
        ultimaClf = data.classificacao || ultimaClf;
        renderGaleriaCapturaReceita();
        atualizarTipoGlobalPorAnexos();
      } else {
        falhasOcr++;
        ultimaMsgErro = data.error || 'Leitura automática indisponível.';
      }
    } catch (_) {
      falhasOcr++;
      ultimaMsgErro = 'Falha na leitura automática.';
    }
  }

  atualizarTipoGlobalPorAnexos();
  if (ultimaClf) atualizarSugestaoReceitaLocal(ultimaClf);

  if (statusEl) {
    if (falhasOcr === 0) {
      statusEl.className = 'pr-status-box ok';
      statusEl.textContent = `✅ Leitura concluída (${selecionados.length} foto${selecionados.length > 1 ? 's' : ''} analisada${selecionados.length > 1 ? 's' : ''}). Confira os dados antes de anexar.`;
    } else if (falhasOcr < selecionados.length) {
      statusEl.className = 'pr-status-box warn';
      statusEl.textContent = `⚠️ Fotos anexadas, mas ${falhasOcr} não pôde ser lida pela IA (${ultimaMsgErro}). Confira e complete manualmente.`;
    } else {
      statusEl.className = 'pr-status-box warn';
      statusEl.textContent = `⚠️ ${ultimaMsgErro} Fotos mantidas para visualização no consultório.`;
    }
  }
}

async function processarImagemReceitaFile(file) {
  if (file) await processarListaImagensReceita([file]);
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
    box.innerHTML = `<strong>🤖 Sugestão automática:</strong> Destino indicado: <b>${escSafe(filaSug)}</b> · Validade: ${validadeTxt} · Vencimento: <b>${escSafe(clfServer.data_vencimento)}</b> ${badgeUrg}`;
    box.dataset.filaSugerida = filaSug;
    box.dataset.dataVenc = clfServer.data_vencimento;
    box.dataset.diasRest = clfServer.dias_restantes ?? '';
    box.dataset.urgencia = clfServer.urgencia || 'normal';
    box.style.display = 'block';
  } else {
    box.innerHTML = `<strong>ℹ️ Classificação:</strong> Receita <b>${tipo === 'azul' ? 'Azul (Controle Especial)' : tipo === 'odonto' ? 'Odontológica' : 'Branca (PEC)'}</b> · Validade padrão: ${validadeTxt} · Destino sugerido: <b>${escSafe(filaSug)}</b>`;
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

  if (_previaAnexosCaptura.length === 0 && !medicamentos && !paciente_nome_ocr) {
    showToast('Tire ao menos uma foto ou informe os medicamentos/dados da prévia!', true);
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
    imagem_base64: _previaAnexosCaptura[0]?.imagem_base64 || null,
    anexos: _previaAnexosCaptura.map(a => ({ ...a })),
    dados_extras: _previaDadosExtrasAtual || null
  };

  const inpNome = document.getElementById('input-nome');
  if (inpNome && !inpNome.value.trim() && paciente_nome_ocr) {
    inpNome.value = paciente_nome_ocr;
  }

  if (aplicarSetorSugerido && fila_sugerida && typeof selecionarSetorRapidoRecepcao === 'function') {
    selecionarSetorRapidoRecepcao(fila_sugerida);
  }

  const selTipoAtend = document.getElementById('input-tipo-atendimento');
  if (selTipoAtend && tipo_receita === 'azul' && selTipoAtend.value === 'Consulta') {
    if ([...selTipoAtend.options].some(o => o.value === 'Renovação de Receita Controlada')) {
      selTipoAtend.value = 'Renovação de Receita Controlada';
    }
  }

  atualizarBotaoPreviaReceitaRecepcao();
  fecharModalCapturaReceita();
  const qtd = _previaAnexosCaptura.length;
  showToast(`📄 Prévia anexada (${qtd} foto${qtd === 1 ? '' : 's'})! Agora finalize clicando em Cadastrar.`);
}

// Paste (Ctrl+V) dentro do modal de captura
document.addEventListener('paste', (e) => {
  const modal = document.getElementById('modal-captura-receita');
  if (!modal || !modal.classList.contains('show')) return;
  const items = e.clipboardData?.items || [];
  const imgs = [];
  for (const item of items) {
    if (item.type && item.type.startsWith('image/')) {
      const f = item.getAsFile();
      if (f) imgs.push(f);
    }
  }
  if (imgs.length > 0) {
    e.preventDefault();
    processarListaImagensReceita(imgs);
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
    urgBadge = `<span class="previa-pill previa-pill-ok">🟢 Válida até ${escSafe(pr.data_vencimento)}</span>`;
  }

  const meta = Array.isArray(pr.anexos_meta) ? pr.anexos_meta : [];
  const qtd = Number(pr.qtd_anexos) || meta.length || (pr.tem_imagem ? 1 : 0);
  const anexosBadge = qtd > 1
    ? `<span class="previa-pill previa-pill-anexos">📎 ${qtd} anexos</span>`
    : '';
  const temEnc = meta.some(m => m?.categoria === 'encaminhamento');
  const temExm = meta.some(m => m?.categoria === 'exame');
  const encBadge = temEnc ? '<span class="previa-pill previa-pill-enc">📋 Encaminhamento</span>' : '';
  const exmBadge = temExm ? '<span class="previa-pill previa-pill-exm">🧪 Exame</span>' : '';

  const revBadge = pr.status_revisao === 'revisada'
    ? '<span class="previa-pill previa-pill-pronta">✅ Receita Pronta</span>'
    : '';

  const medPreview = pr.medicamentos
    ? `<div class="previa-med-resumo">💊 ${escSafe(String(pr.medicamentos).slice(0, 90))}${String(pr.medicamentos).length > 90 ? '...' : ''}</div>`
    : '';

  return `<div class="previa-row-box">${tipoBadge}${urgBadge}${anexosBadge}${encBadge}${exmBadge}${revBadge}${medPreview}</div>`;
}

function renderBotaoPreviaReceitaLinha(p, setor) {
  if (!p?.previa_receita) return '';
  const safeNome = String(p.nome || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
  const pronto = p.previa_receita.status_revisao === 'revisada';
  const qtd = Number(p.previa_receita.qtd_anexos) || 0;
  const sufixo = qtd > 1 ? ` (${qtd})` : '';
  return `<button class="btn-previa-receita ${pronto ? 'revisada' : ''}" onclick="event.stopPropagation();abrirModalVerPreviaReceita(${p.id},'${safeNome}','${setor}')" title="Ver foto(s) e dados extraídos antes do atendimento">${pronto ? '✅ Prévia' : '👁️ Prévia'}${sufixo}</button>`;
}

function renderFotoAtivaPreviaModal() {
  const imgEl = document.getElementById('vp-img');
  const semImgEl = document.getElementById('vp-sem-img');
  const dlEl = document.getElementById('vp-btn-download');
  const navBar = document.getElementById('vp-nav-bar');
  const counterEl = document.getElementById('vp-foto-counter');
  const catBadge = document.getElementById('vp-foto-cat-badge');
  const strip = document.getElementById('vp-thumbs-strip');

  const total = _previaModalAnexos.length;
  if (_previaModalFotoIdx >= total) _previaModalFotoIdx = Math.max(0, total - 1);
  const ativo = total > 0 ? _previaModalAnexos[_previaModalFotoIdx] : null;

  resetPreviaImgView();

  if (ativo && ativo.imagem_base64) {
    imgEl.src = ativo.imagem_base64;
    imgEl.style.display = 'block';
    semImgEl.style.display = 'none';
    if (dlEl) {
      dlEl.href = ativo.imagem_base64;
      dlEl.download = `documento-${_previaModalFotoIdx + 1}.jpg`;
      dlEl.style.display = 'inline-flex';
    }
  } else {
    imgEl.style.display = 'none';
    semImgEl.style.display = 'flex';
    semImgEl.textContent = '📄 Prévia registrada apenas em texto (sem foto anexada)';
    if (dlEl) dlEl.style.display = 'none';
  }

  if (navBar) {
    navBar.style.display = total > 0 ? 'flex' : 'none';
    if (counterEl) counterEl.textContent = `Foto ${_previaModalFotoIdx + 1} de ${total}`;
    if (catBadge && ativo) {
      const cat = normalizarCategoriaAnexoFront(ativo.categoria);
      catBadge.textContent = `${CATEGORIAS_ANEXO_LABEL[cat] || '📄 Documento'}${ativo.rotulo ? ' · ' + ativo.rotulo : ''}`;
    }
    const prevBtn = document.getElementById('vp-btn-prev');
    const nextBtn = document.getElementById('vp-btn-next');
    if (prevBtn) prevBtn.style.visibility = total > 1 ? 'visible' : 'hidden';
    if (nextBtn) nextBtn.style.visibility = total > 1 ? 'visible' : 'hidden';
  }

  if (strip) {
    if (total > 1) {
      strip.style.display = 'flex';
      strip.innerHTML = _previaModalAnexos.map((a, idx) => {
        const cat = normalizarCategoriaAnexoFront(a.categoria);
        const icone = cat === 'receita_azul' ? '🔵' : cat === 'encaminhamento' ? '📋' : cat === 'exame' ? '🧪' : cat === 'odonto' ? '🦷' : '⚪';
        return `<button type="button" class="vp-thumb-btn${idx === _previaModalFotoIdx ? ' active' : ''}" onclick="selecionarFotoPrevia(${idx})">
          <img src="${a.imagem_base64}" alt="Foto ${idx + 1}">
          <span>${icone} ${idx + 1}</span>
        </button>`;
      }).join('');
    } else {
      strip.style.display = 'none';
      strip.innerHTML = '';
    }
  }

  const catAtiva = ativo ? normalizarCategoriaAnexoFront(ativo.categoria) : null;
  const btnRec = document.getElementById('vp-btn-form-rec');
  const btnEsp = document.getElementById('vp-btn-form-esp');
  const btnAmb = document.getElementById('vp-btn-form-amb');
  if (btnRec && btnEsp && btnAmb) {
    const tipoGeral = window._previaModalDadosAtuais?.previa?.tipo_receita;
    const isEnc = catAtiva === 'encaminhamento' || catAtiva === 'exame';
    const isAzul = catAtiva === 'receita_azul' || (!catAtiva && tipoGeral === 'azul');
    btnAmb.classList.toggle('destaque', isEnc);
    btnEsp.classList.toggle('destaque', !isEnc && isAzul);
    btnRec.classList.toggle('destaque', !isEnc && !isAzul);
  }

  if (window._previaModalDadosAtuais) {
    window._previaModalDadosAtuais.anexos = _previaModalAnexos;
    window._previaModalDadosAtuais.activeIdx = _previaModalFotoIdx;
  }
}

function navegarFotoPrevia(delta) {
  if (_previaModalAnexos.length <= 1) return;
  _previaModalFotoIdx = (_previaModalFotoIdx + delta + _previaModalAnexos.length) % _previaModalAnexos.length;
  renderFotoAtivaPreviaModal();
}

function selecionarFotoPrevia(idx) {
  if (idx < 0 || idx >= _previaModalAnexos.length) return;
  _previaModalFotoIdx = idx;
  renderFotoAtivaPreviaModal();
}

async function abrirModalVerPreviaReceita(patientId, nomePaciente, setor) {
  const modal = document.getElementById('modal-ver-previa-receita');
  if (!modal) return;
  _previaModalPacienteId = patientId;
  _previaModalAnexos = [];
  _previaModalFotoIdx = 0;
  resetPreviaImgView();
  window._previaModalDadosAtuais = { patientId, nomePaciente, setor, previa: null, anexos: [], activeIdx: 0 };
  inicializarPanZoomPreviaModal();

  document.getElementById('vp-titulo').textContent = `📄 Prévia de Documentos — ${nomePaciente}`;
  document.getElementById('vp-subtitulo').textContent = `Setor: ${setor} · Carregando dados...`;
  document.getElementById('vp-img').src = '';
  document.getElementById('vp-img').style.display = 'none';
  document.getElementById('vp-sem-img').style.display = 'flex';
  document.getElementById('vp-sem-img').textContent = '⏳ Carregando imagem...';
  const navBar = document.getElementById('vp-nav-bar');
  const strip = document.getElementById('vp-thumbs-strip');
  if (navBar) navBar.style.display = 'none';
  if (strip) { strip.style.display = 'none'; strip.innerHTML = ''; }

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

    if (Array.isArray(pr.anexos) && pr.anexos.length > 0) {
      _previaModalAnexos = pr.anexos;
    } else if (pr.imagem_base64) {
      _previaModalAnexos = [{
        id: 'anx_1',
        categoria: normalizarCategoriaAnexoFront(pr.tipo_receita),
        rotulo: null,
        imagem_base64: pr.imagem_base64,
        ocr: null
      }];
    } else {
      _previaModalAnexos = [];
    }

    window._previaModalDadosAtuais = {
      patientId,
      nomePaciente,
      setor,
      previa: pr,
      anexos: _previaModalAnexos,
      activeIdx: 0
    };

    const totalTxt = _previaModalAnexos.length > 1 ? ` · 📎 ${_previaModalAnexos.length} fotos` : '';
    document.getElementById('vp-subtitulo').textContent = `Setor: ${setor}${totalTxt}${pr.status_revisao === 'revisada' ? ' · ✅ Marcada como pronta' : ' · ⏳ Aguardando revisão'}`;
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

    renderFotoAtivaPreviaModal();

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
