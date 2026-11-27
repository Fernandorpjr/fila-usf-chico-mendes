// Módulo Frontend — Prévia de Receitas e Encaminhamentos (até 6 anexos por paciente)
const MAX_ANEXOS_CAPTURA = 6;
const MAX_PREVIA_PDF_BYTES = 2_000_000;
const CATEGORIAS_ANEXO_LABEL = {
  receita_branca: '⚪ Receita Branca',
  receita_azul: '🔵 Receita Azul',
  odonto: '🦷 Odonto',
  encaminhamento: '📋 SISREG / Encam.',
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
let _vpPdfBlobUrl = null;
let _previaCapturaTargetPatient = null;
let _previaAnalisesAtivas = 0;

function formatarTagProvedorPrevia(data) {
  const modelRaw = String(data?.model || '').trim();
  const isGroq = data?.provider === 'groq' || /^groq\//i.test(modelRaw);
  return isGroq ? '(Groq)' : '(Gemini)';
}

async function fetchJsonPreviaComTimeout(url, options = {}, timeoutMs = 42000) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller ? controller.signal : undefined
    });
    const txt = await res.text();
    let data = {};
    try { data = txt ? JSON.parse(txt) : {}; } catch (_) {
      data = { ok: false, error: `Resposta inválida do servidor (HTTP ${res.status}).` };
    }
    return { res, data };
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error('Tempo limite excedido ao analisar imagem (42s). Foto mantida na prévia — tente novamente em alguns segundos.');
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isPreviaAnexoPdf(anx) {
  if (!anx) return false;
  if (typeof anx === 'string') return anx.trim().toLowerCase().startsWith('data:application/pdf');
  return anx.mime_type === 'application/pdf' ||
    (typeof anx.imagem_base64 === 'string' && anx.imagem_base64.trim().toLowerCase().startsWith('data:application/pdf'));
}

function revogarVpPdfBlobUrl() {
  if (_vpPdfBlobUrl) {
    try { URL.revokeObjectURL(_vpPdfBlobUrl); } catch (_) {}
    _vpPdfBlobUrl = null;
  }
}

function criarBlobUrlPdfPrevia(dataUrl) {
  try {
    const b64 = String(dataUrl || '').includes(',') ? String(dataUrl).split(',')[1] : String(dataUrl || '');
    const binStr = atob(b64);
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  } catch (_) {
    return null;
  }
}

function lerPdfBase64Previa(file) {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_PREVIA_PDF_BYTES) {
      reject(new Error(`PDF "${file.name}" excede 2 MB. Use um arquivo menor ou tire foto/print.`));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler arquivo PDF'));
    reader.onload = (ev) => resolve(ev.target.result);
    reader.readAsDataURL(file);
  });
}

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
  const ehRegulacao = setor === 'Regulação';
  const ehDestaqueSetor = ['Regulação', 'Farmácia', 'Acolhimento', 'Acolhimento ACS', 'Acolhimento 2ª Escuta'].includes(setor);
  bar.style.display = 'flex';

  const tiposDestaque = ['Hiperdia', 'Renovação de Receita', 'Renovação de Receita Controlada'];
  bar.classList.toggle('destaque-receita', ehDestaqueSetor || tiposDestaque.includes(tipo) || ehRegulacao);

  const subTxt = document.getElementById('recepcao-previa-subtxt');
  if (subTxt) {
    subTxt.textContent = 'Anexe receita, exame ou encaminhamento (foto ou PDF) para qualquer fila';
  }

  const pill = document.getElementById('recepcao-previa-anexada-pill');
  const txtPill = document.getElementById('recepcao-previa-anexada-txt');
  const btnCap = document.getElementById('btn-abrir-previa-recepcao');
  if (window._previaReceitaPendente) {
    const p = window._previaReceitaPendente;
    const qtd = Array.isArray(p.anexos) ? p.anexos.length : (p.imagem_base64 ? 1 : 0);
    const ehSisreg = p.tipo_receita === 'sisreg' || p.dados_extras?.destino_ia === 'sisreg' || p.fila_sugerida === 'Regulação';
    const resumo = p.medicamentos
      ? String(p.medicamentos).slice(0, 32) + (String(p.medicamentos).length > 32 ? '...' : '')
      : (p.dados_extras?.especialidade ? String(p.dados_extras.especialidade).slice(0, 32) : 'Dados preenchidos');
    const iconeTipo = ehSisreg ? '📋 SISREG' : '💊 Receita';
    if (pill) pill.style.display = 'inline-flex';
    if (txtPill) txtPill.textContent = `📎 ${qtd || 1} arquivo(s) · ${iconeTipo}${resumo ? ': ' + resumo : ''}`;
    if (btnCap) btnCap.textContent = qtd > 0 ? `✏️ Editar Prévia (${qtd} arquivo${qtd > 1 ? 's' : ''} · Liberado para teste)` : '✏️ Editar Prévia (Liberado para teste)';
  } else {
    if (pill) pill.style.display = 'none';
    if (btnCap) btnCap.textContent = '📷 Prévia (Liberado para teste)';
  }
}

function limparPreviaReceitaPendente() {
  window._previaReceitaPendente = null;
  _previaAnexosCaptura = [];
  _previaDadosExtrasAtual = null;
  atualizarBotaoPreviaReceitaRecepcao();
}

function configurarCabecalhoBotoesCaptura(target) {
  const titEl = document.getElementById('pr-modal-titulo');
  const btnConf = document.getElementById('pr-btn-confirmar');
  const btnSug = document.getElementById('pr-btn-confirmar-sugerido');
  const btnNova = document.getElementById('pr-btn-nova-analise');
  if (target && target.modoAnaliseAvulsa) {
    if (titEl) titEl.textContent = '💊 Analisar Receituário (Foto ou PDF)';
    if (btnConf) btnConf.style.display = 'none';
    if (btnSug) btnSug.style.display = 'none';
    if (btnNova) btnNova.style.display = 'inline-flex';
  } else if (target && target.id) {
    if (titEl) titEl.textContent = `📎 Anexar Prévia — ${target.nome} (${target.setor})`;
    if (btnConf) {
      btnConf.textContent = '💾 Salvar Prévia neste Paciente';
      btnConf.style.display = 'inline-flex';
    }
    if (btnSug) btnSug.style.display = 'none';
    if (btnNova) btnNova.style.display = 'none';
  } else {
    if (titEl) titEl.textContent = '📎 Prévia de Documentos (Foto ou PDF — até 6 arquivos)';
    if (btnConf) {
      btnConf.textContent = '✅ Anexar na Fila Atual';
      btnConf.style.display = 'inline-flex';
    }
    if (btnSug) btnSug.style.display = 'inline-flex';
    if (btnNova) btnNova.style.display = 'none';
  }
}

function abrirModalCapturaReceita() {
  const modal = document.getElementById('modal-captura-receita');
  if (!modal) return;
  _previaCapturaTargetPatient = null;
  configurarCabecalhoBotoesCaptura(null);

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
  const tipoDefault = p.tipo_receita || (setorAtual === 'Odontologia' ? 'odonto' : setorAtual === 'Regulação' ? 'sisreg' : 'branca');

  const extInit = p.dados_extras && typeof p.dados_extras === 'object' ? p.dados_extras : {};
  document.getElementById('pr-tipo').value = tipoDefault;
  document.getElementById('pr-paciente-nome').value = p.paciente_nome_ocr || document.getElementById('input-nome')?.value || '';
  document.getElementById('pr-paciente-cns').value = p.paciente_cns || '';
  if (document.getElementById('pr-paciente-cpf')) document.getElementById('pr-paciente-cpf').value = extInit.paciente_cpf || '';
  if (document.getElementById('pr-paciente-telefone')) document.getElementById('pr-paciente-telefone').value = extInit.paciente_telefone || '';
  if (document.getElementById('pr-paciente-cep')) document.getElementById('pr-paciente-cep').value = extInit.paciente_cep || '';
  if (document.getElementById('pr-paciente-bairro')) document.getElementById('pr-paciente-bairro').value = extInit.paciente_bairro || '';
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

function abrirModalAnalisarReceituario(setor = 'Médico') {
  const modal = document.getElementById('modal-captura-receita');
  if (!modal) return;
  _previaCapturaTargetPatient = { id: null, modoAnaliseAvulsa: true, setor: setor || 'Médico' };
  configurarCabecalhoBotoesCaptura(_previaCapturaTargetPatient);

  _previaAnexosCaptura = [];
  _previaDadosExtrasAtual = null;

  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  setVal('pr-tipo', setor === 'Odontologia' ? 'odonto' : 'branca');
  setVal('pr-paciente-nome', '');
  setVal('pr-paciente-cns', '');
  setVal('pr-paciente-cpf', '');
  setVal('pr-paciente-telefone', '');
  setVal('pr-paciente-cep', '');
  setVal('pr-paciente-bairro', '');
  setVal('pr-medicamentos', '');
  setVal('pr-data-emissao', '');
  setVal('pr-medico-emitente', '');
  setVal('pr-observacoes', '');

  const statusEl = document.getElementById('pr-ocr-status');
  if (statusEl) statusEl.style.display = 'none';

  renderGaleriaCapturaReceita();
  atualizarSugestaoReceitaLocal();
  modal.classList.add('show');
}
window.abrirModalAnalisarReceituario = abrirModalAnalisarReceituario;

async function abrirModalCapturaReceitaPaciente(patientId, nomePaciente, setor) {
  const modal = document.getElementById('modal-captura-receita');
  if (!modal) return;
  _previaCapturaTargetPatient = { id: Number(patientId), nome: nomePaciente || '', setor: setor || '' };
  configurarCabecalhoBotoesCaptura(_previaCapturaTargetPatient);

  _previaAnexosCaptura = [];
  _previaDadosExtrasAtual = null;
  document.getElementById('pr-tipo').value = setor === 'Odontologia' ? 'odonto' : setor === 'Regulação' ? 'sisreg' : 'branca';
  document.getElementById('pr-paciente-nome').value = nomePaciente || '';
  document.getElementById('pr-paciente-cns').value = '';
  if (document.getElementById('pr-paciente-cpf')) document.getElementById('pr-paciente-cpf').value = '';
  if (document.getElementById('pr-paciente-telefone')) document.getElementById('pr-paciente-telefone').value = '';
  if (document.getElementById('pr-paciente-cep')) document.getElementById('pr-paciente-cep').value = '';
  if (document.getElementById('pr-paciente-bairro')) document.getElementById('pr-paciente-bairro').value = '';
  document.getElementById('pr-medicamentos').value = '';
  document.getElementById('pr-data-emissao').value = '';
  document.getElementById('pr-medico-emitente').value = '';
  document.getElementById('pr-observacoes').value = '';
  const statusEl = document.getElementById('pr-ocr-status');
  if (statusEl) statusEl.style.display = 'none';

  renderGaleriaCapturaReceita();
  atualizarSugestaoReceitaLocal();
  modal.classList.add('show');

  try {
    const r = await fetch(`${API_URL}/patients/${patientId}/previa-receita`, { cache: 'no-store' });
    if (r.ok && _previaCapturaTargetPatient?.id === Number(patientId)) {
      const p = await r.json();
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
      }
      const extPac = p.dados_extras && typeof p.dados_extras === 'object' ? p.dados_extras : {};
      _previaDadosExtrasAtual = p.dados_extras ? { ...p.dados_extras } : null;
      if (p.tipo_receita) document.getElementById('pr-tipo').value = p.tipo_receita;
      document.getElementById('pr-paciente-nome').value = p.paciente_nome_ocr || nomePaciente || '';
      document.getElementById('pr-paciente-cns').value = p.paciente_cns || '';
      if (document.getElementById('pr-paciente-cpf')) document.getElementById('pr-paciente-cpf').value = extPac.paciente_cpf || '';
      if (document.getElementById('pr-paciente-telefone')) document.getElementById('pr-paciente-telefone').value = extPac.paciente_telefone || '';
      if (document.getElementById('pr-paciente-cep')) document.getElementById('pr-paciente-cep').value = extPac.paciente_cep || '';
      if (document.getElementById('pr-paciente-bairro')) document.getElementById('pr-paciente-bairro').value = extPac.paciente_bairro || '';
      document.getElementById('pr-medicamentos').value = p.medicamentos || '';
      document.getElementById('pr-data-emissao').value = p.data_emissao || '';
      document.getElementById('pr-medico-emitente').value = p.medico_emitente || '';
      document.getElementById('pr-observacoes').value = p.observacoes || '';
      renderGaleriaCapturaReceita();
      atualizarSugestaoReceitaLocal();
    }
  } catch (_) {}
}

function fecharModalCapturaReceita() {
  document.getElementById('modal-captura-receita')?.classList.remove('show');
  _previaCapturaTargetPatient = null;
}

function atualizarBotaoCameraCaptura() {
  const btnCam = document.getElementById('pr-btn-camera');
  if (!btnCam) return;
  const qtd = _previaAnexosCaptura.length;
  btnCam.textContent = qtd > 0
    ? `📸 + Tirar outra foto (${qtd}/${MAX_ANEXOS_CAPTURA})`
    : '📸 Tirar Foto (Câmera)';
}

function renderGaleriaCapturaReceita() {
  const wrap = document.getElementById('pr-galeria-wrap');
  const grid = document.getElementById('pr-galeria-grid');
  const cntEl = document.getElementById('pr-galeria-count');
  atualizarBotaoCameraCaptura();
  if (!wrap || !grid) return;

  if (_previaAnexosCaptura.length === 0) {
    wrap.style.display = 'none';
    grid.innerHTML = '';
    return;
  }

  wrap.style.display = 'block';
  if (cntEl) {
    cntEl.textContent = `📎 ${_previaAnexosCaptura.length} / ${MAX_ANEXOS_CAPTURA} arquivos anexados`;
  }

  const optsHtml = (sel) => Object.entries(CATEGORIAS_ANEXO_LABEL)
    .map(([k, lab]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${lab}</option>`)
    .join('');

  grid.innerHTML = _previaAnexosCaptura.map((anx, idx) => {
    const ehPdf = isPreviaAnexoPdf(anx);
    const thumbMedia = ehPdf
      ? `<div class="pr-thumb-pdf"><span style="font-size:24px;">📄</span><small>${escSafe(anx.nome_arquivo || 'Documento PDF')}</small></div>`
      : `<img src="${anx.imagem_base64}" alt="Anexo ${idx + 1}" class="pr-thumb-img">`;
    return `
      <div class="pr-thumb-card">
        <button type="button" class="pr-thumb-rm" onclick="removerFotoCapturaReceita(${idx})" title="Remover este arquivo">✕</button>
        ${thumbMedia}
        <select class="pr-thumb-cat" onchange="alterarCategoriaAnexoCaptura(${idx}, this.value)">
          ${optsHtml(normalizarCategoriaAnexoFront(anx.categoria))}
        </select>
      </div>
    `;
  }).join('');
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
  const temReceita = cats.some(c => c === 'receita_branca' || c === 'receita_azul' || c === 'odonto');
  if (cats.includes('receita_azul')) sel.value = 'azul';
  else if (cats.includes('odonto') && sel.value !== 'azul') sel.value = 'odonto';
  else if (cats.includes('encaminhamento') && !temReceita) sel.value = 'sisreg';
  atualizarSugestaoReceitaLocal();
}

function comprimirFotoReceita(file) {
  return new Promise((resolve, reject) => {
    const objUrl = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : null;
    if (!objUrl) {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
      reader.onload = (ev) => resolve(ev.target.result);
      reader.readAsDataURL(file);
      return;
    }
    const img = new Image();
    let finalizado = false;
    const finalizar = (cb) => {
      if (finalizado) return;
      finalizado = true;
      clearTimeout(timer);
      try { URL.revokeObjectURL(objUrl); } catch (_) {}
      cb();
    };
    const timer = setTimeout(() => {
      finalizar(() => reject(new Error('Tempo esgotado ao carregar foto da câmera.')));
    }, 12000);
    img.onerror = () => finalizar(() => reject(new Error('Não foi possível decodificar a foto capturada.')));
    img.onload = () => {
      finalizar(() => {
        try {
          const MAX = 1050;
          let w = img.naturalWidth || img.width || MAX;
          let h = img.naturalHeight || img.height || MAX;
          if (w > MAX || h > MAX) {
            if (w > h) { h = Math.round(h * (MAX / w)); w = MAX; }
            else { w = Math.round(w * (MAX / h)); h = MAX; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
          canvas.width = 0;
          canvas.height = 0;
          resolve(dataUrl);
        } catch (err) {
          reject(err);
        }
      });
    };
    img.src = objUrl;
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
  const ext = o.dados_extras && typeof o.dados_extras === 'object' ? o.dados_extras : {};
  setIfBlank('pr-paciente-nome', o.paciente_nome);
  setIfBlank('pr-paciente-cns', o.paciente_cns);
  setIfBlank('pr-paciente-cpf', o.paciente_cpf || ext.paciente_cpf);
  setIfBlank('pr-paciente-telefone', ext.paciente_telefone);
  setIfBlank('pr-paciente-cep', ext.paciente_cep);
  setIfBlank('pr-paciente-bairro', ext.paciente_bairro);
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

  if (!document.getElementById('pr-medicamentos')?.value.trim() && ext.especialidade) {
    setIfBlank('pr-medicamentos', ext.especialidade);
  }
  if (!document.getElementById('pr-observacoes')?.value.trim() && (ext.observacoes_revisada || ext.justificativa)) {
    setIfBlank('pr-observacoes', ext.observacoes_revisada || ext.justificativa);
  }
  const merged = { ...(_previaDadosExtrasAtual || {}) };
  [
    'paciente_cpf', 'paciente_rg', 'paciente_endereco', 'paciente_numero', 'paciente_complemento',
    'paciente_bairro', 'paciente_cep', 'paciente_municipio', 'paciente_uf',
    'paciente_data_nascimento', 'paciente_sexo', 'paciente_telefone', 'paciente_mae',
    'especialidade', 'tipo_vaga', 'risco', 'hipotese_diagnostica', 'cid10',
    'codigo_solicitacao', 'observacoes_revisada', 'destino_ia'
  ].forEach(k => {
    if (!merged[k] && ext[k]) merged[k] = ext[k];
  });
  if (!merged.paciente_cpf && o.paciente_cpf) merged.paciente_cpf = o.paciente_cpf;
  if (typeof ext.tem_hipertensao === 'boolean') merged.tem_hipertensao = merged.tem_hipertensao || ext.tem_hipertensao;
  if (typeof ext.tem_diabetes === 'boolean') merged.tem_diabetes = merged.tem_diabetes || ext.tem_diabetes;
  if (o.destino_ia && !merged.destino_ia) merged.destino_ia = o.destino_ia;
  if (Array.isArray(ext.alertas_digitacao) && ext.alertas_digitacao.length > 0) {
    merged.alertas_digitacao = Array.from(new Set([...(merged.alertas_digitacao || []), ...ext.alertas_digitacao]));
  }
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
  const files = Array.from(fileList || []).filter(f => {
    if (!f) return false;
    const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
    const isImg = !f.type || f.type.startsWith('image/');
    return isPdf || isImg;
  });
  if (files.length === 0) return;

  const vagas = MAX_ANEXOS_CAPTURA - _previaAnexosCaptura.length;
  if (vagas <= 0) {
    showToast(`Limite máximo de ${MAX_ANEXOS_CAPTURA} arquivos atingido para este paciente.`, true);
    return;
  }

  const selecionados = files.slice(0, vagas);
  if (files.length > vagas) {
    showToast(`Foram adicionados ${vagas} arquivos (limite de ${MAX_ANEXOS_CAPTURA} por paciente).`, true);
  }

  const statusEl = document.getElementById('pr-ocr-status');
  const tipoAtual = document.getElementById('pr-tipo')?.value || 'branca';
  const setorRecepcao = document.getElementById('input-setor')?.value || '';
  const novosAnexos = [];
  let falhasLeituraLocal = 0;

  // Passo 1: comprimir e exibir imediatamente todos os anexos (evita perda da 2ª foto da câmera)
  for (let i = 0; i < selecionados.length; i++) {
    const file = selecionados[i];
    const ehPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    try {
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.className = 'pr-status-box loading';
        statusEl.textContent = ehPdf
          ? '⏳ Preparando PDF...'
          : (selecionados.length > 1
            ? `⏳ Preparando foto ${i + 1} de ${selecionados.length}...`
            : '⏳ Preparando foto capturada...');
      }
      const b64 = ehPdf ? await lerPdfBase64Previa(file) : await comprimirFotoReceita(file);
      const novoAnexo = {
        id: `anx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}_${i + 1}`,
        categoria: setorRecepcao === 'Regulação' ? 'encaminhamento' : normalizarCategoriaAnexoFront(tipoAtual),
        rotulo: ehPdf ? 'PDF' : null,
        imagem_base64: b64,
        ocr: null
      };
      if (ehPdf) {
        novoAnexo.mime_type = 'application/pdf';
        novoAnexo.nome_arquivo = file.name || 'documento.pdf';
      }
      _previaAnexosCaptura.push(novoAnexo);
      novosAnexos.push({ anexo: novoAnexo, b64, ehPdf });
      renderGaleriaCapturaReceita();
    } catch (err) {
      falhasLeituraLocal++;
      showToast(err?.message || 'Erro ao preparar arquivo selecionado.', true);
    }
  }

  if (novosAnexos.length === 0) {
    if (statusEl && falhasLeituraLocal > 0) {
      statusEl.style.display = 'block';
      statusEl.className = 'pr-status-box warn';
      statusEl.textContent = '⚠️ Não foi possível ler a imagem selecionada.';
    }
    return;
  }

  await executarOcrEmListaPrevia(novosAnexos);
}

async function reanalisarAnexosPendentesReceita() {
  if (_previaAnexosCaptura.length === 0) return;
  const pendentes = _previaAnexosCaptura
    .filter(a => a && a.imagem_base64 && !a.ocr)
    .map(anexo => ({ anexo, b64: anexo.imagem_base64, ehPdf: isPreviaAnexoPdf(anexo) }));
  const alvos = pendentes.length > 0
    ? pendentes
    : _previaAnexosCaptura
      .filter(a => a && a.imagem_base64)
      .map(anexo => ({ anexo, b64: anexo.imagem_base64, ehPdf: isPreviaAnexoPdf(anexo) }));
  await executarOcrEmListaPrevia(alvos);
}

async function executarOcrEmListaPrevia(novosAnexos) {
  if (!Array.isArray(novosAnexos) || novosAnexos.length === 0) return;
  const statusEl = document.getElementById('pr-ocr-status');
  let ultimaClf = null;
  let ultimaTagProvedor = '';
  let falhasOcr = 0;
  let ultimaMsgErro = '';
  _previaAnalisesAtivas++;
  try {
    for (let i = 0; i < novosAnexos.length; i++) {
      const { anexo, b64, ehPdf } = novosAnexos[i];
      try {
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.className = 'pr-status-box loading';
          statusEl.textContent = ehPdf
            ? '⏳ Lendo PDF e identificando o documento...'
            : (novosAnexos.length > 1
              ? `⏳ Analisando arquivo ${i + 1} de ${novosAnexos.length}... (você já pode anexar outra foto)`
              : '⏳ Analisando documento...');
        }

        const { data } = await fetchJsonPreviaComTimeout(`${API_URL}/receita-previa/analisar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ arquivo_base64: b64 })
        }, 42000);

        if (data.ok && data.ocr) {
          ultimaTagProvedor = formatarTagProvedorPrevia(data);
          const o = data.ocr;
          const ehSisreg = data.classificacao?.categoria_destino === 'sisreg' || o.destino_ia === 'sisreg';
          const cat = ehSisreg
            ? 'encaminhamento'
            : normalizarCategoriaAnexoFront(o.tipo_documento || o.tipo_receita);
          anexo.categoria = cat;
          anexo.ocr = {
            destino_ia: ehSisreg ? 'sisreg' : 'receita',
            tipo_receita: o.tipo_receita || null,
            tipo_documento: cat,
            medicamento: o.medicamento || null,
            medicamentos_posologia: o.dados_extras?.medicamentos_posologia || null,
            data_emissao: o.data_emissao || null,
            observacoes: o.observacoes || null,
            especialidade: o.dados_extras?.especialidade || null,
            hipotese_diagnostica: o.dados_extras?.hipotese_diagnostica || null,
            cid10: o.dados_extras?.cid10 || null,
            justificativa: o.dados_extras?.justificativa || null,
            observacoes_revisada: o.dados_extras?.observacoes_revisada || null,
            codigo_solicitacao: o.dados_extras?.codigo_solicitacao || null,
            paciente_cpf: o.paciente_cpf || o.dados_extras?.paciente_cpf || null,
            paciente_rg: o.dados_extras?.paciente_rg || null,
            paciente_telefone: o.dados_extras?.paciente_telefone || null,
            paciente_endereco: o.dados_extras?.paciente_endereco || null,
            paciente_numero: o.dados_extras?.paciente_numero || null,
            paciente_complemento: o.dados_extras?.paciente_complemento || null,
            paciente_bairro: o.dados_extras?.paciente_bairro || null,
            paciente_municipio: o.dados_extras?.paciente_municipio || null,
            paciente_cep: o.dados_extras?.paciente_cep || null,
            paciente_uf: o.dados_extras?.paciente_uf || null,
            risco: o.dados_extras?.risco || null,
            tipo_vaga: o.dados_extras?.tipo_vaga || null
          };
          if (o.dados_extras?.especialidade) {
            anexo.rotulo = String(o.dados_extras.especialidade).slice(0, 40);
          }
          mesclarOcrNoFormularioCaptura(o);
          if (ehSisreg) {
            const selTipo = document.getElementById('pr-tipo');
            if (selTipo) selTipo.value = 'sisreg';
          }
          ultimaClf = data.classificacao || ultimaClf;
          renderGaleriaCapturaReceita();
          atualizarTipoGlobalPorAnexos();
        } else {
          falhasOcr++;
          ultimaMsgErro = data.error || 'Leitura automática indisponível.';
        }
      } catch (err) {
        falhasOcr++;
        ultimaMsgErro = err?.message || 'Falha na leitura automática.';
      }
    }
  } finally {
    _previaAnalisesAtivas = Math.max(0, _previaAnalisesAtivas - 1);
  }

  atualizarTipoGlobalPorAnexos();
  if (ultimaClf) atualizarSugestaoReceitaLocal(ultimaClf);

  if (statusEl && _previaAnalisesAtivas === 0) {
    if (falhasOcr === 0) {
      let destLabel = '📋 Documento do SISREG / Regulação identificado!';
      if (ultimaClf?.categoria_destino !== 'sisreg') {
        const filaRec = ultimaClf?.fila_destino || 'Médico';
        const profLabel = filaRec === 'Enfermagem'
          ? '🟢 Enfermeiro pode fazer (Enfermagem)'
          : filaRec === 'Odontologia'
            ? '🦷 Dentista pode fazer (Odontologia)'
            : '🔵 Somente Médico pode fazer';
        destLabel = `💊 Receita identificada · ${profLabel}`;
      }
      statusEl.className = 'pr-status-box ok';
      statusEl.textContent = `✅ Leitura concluída (${_previaAnexosCaptura.length} arquivo${_previaAnexosCaptura.length > 1 ? 's' : ''} na prévia) · ${destLabel}${ultimaTagProvedor ? ' · ' + ultimaTagProvedor : ''}`;
    } else {
      const prefix = falhasOcr < novosAnexos.length
        ? `⚠️ Arquivos anexados, mas ${falhasOcr} não pôde ser lido automaticamente (${ultimaMsgErro}).`
        : `⚠️ ${ultimaMsgErro}`;
      statusEl.className = 'pr-status-box warn';
      statusEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
        <span>${escSafe(prefix)}</span>
        <button type="button" class="btn btn-outline btn-sm" style="background:#fff;border-color:#d97706;color:#92400e;font-weight:800;" onclick="reanalisarAnexosPendentesReceita()">🔄 Tentar ler novamente</button>
      </div>`;
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
  const ehSisreg = tipo === 'sisreg' || clfServer?.categoria_destino === 'sisreg' || _previaDadosExtrasAtual?.destino_ia === 'sisreg';

  if (ehSisreg) {
    const esp = _previaDadosExtrasAtual?.especialidade ? escSafe(_previaDadosExtrasAtual.especialidade) : 'Não informada no documento';
    const tel = _previaDadosExtrasAtual?.paciente_telefone ? escSafe(_previaDadosExtrasAtual.paciente_telefone) : 'Não identificado';
    box.className = 'pr-decision-hero pr-verdict-sisreg';
    box.innerHTML = `
      <div class="pr-verdict-head">
        <div class="pr-verdict-title-wrap">
          <span class="pr-verdict-kicker">📋 SISREG</span>
          <span class="pr-verdict-main pr-verdict-main--sisreg">📋 ENCAMINHAR PARA REGULAÇÃO (SISREG)</span>
        </div>
        <span class="pr-verdict-status-pill pr-status-info">🎯 Setor: Regulação</span>
      </div>
      <div class="pr-verdict-cards">
        <div class="pr-verdict-card pr-verdict-card--info">
          <div class="pr-vc-label">📌 Pedido / Especialidade</div>
          <div class="pr-vc-value">${esp}</div>
        </div>
        <div class="pr-verdict-card pr-verdict-card--info">
          <div class="pr-vc-label">📞 Telefone Extraído</div>
          <div class="pr-vc-value">${tel}</div>
        </div>
        <div class="pr-verdict-card pr-verdict-card--ok">
          <div class="pr-vc-label">➡️ Encaminhamento</div>
          <div class="pr-vc-value" style="color:#065f46;">Regulação</div>
          <div class="pr-vc-sub">Use “Anexar + Usar Setor Sugerido” abaixo.</div>
        </div>
      </div>`;
    box.dataset.filaSugerida = 'Regulação';
    box.style.display = 'block';
    if (clfServer) {
      const bodyEl = document.querySelector('#modal-captura-receita .previa-modal-body');
      if (bodyEl) bodyEl.scrollTop = 0;
    }
    return;
  }

  let filaSug = clfServer?.fila_destino || (tipo === 'azul' ? 'Médico' : tipo === 'odonto' ? 'Odontologia' : 'Médico');
  const validadeTxt = clfServer?.regra_validade || (tipo === 'azul' ? '2 meses (Azul)' : '6 meses');
  const tipoRotulo = tipo === 'azul' ? '💊 RECEITA AZUL' : tipo === 'odonto' ? '🦷 RECEITA ODONTO' : '💊 RECEITA';

  const heroTema = filaSug === 'Enfermagem'
    ? 'pr-verdict-enfermagem'
    : filaSug === 'Odontologia'
      ? 'pr-verdict-odonto'
      : 'pr-verdict-medico';
  const urgClass = (clfServer && clfServer.data_vencimento)
    ? (clfServer.urgencia === 'vencida' ? 'is-vencida' : clfServer.urgencia === 'urgente' ? 'is-urgente' : '')
    : '';
  box.className = ['pr-decision-hero', heroTema, urgClass].filter(Boolean).join(' ');

  const profVerdict = filaSug === 'Enfermagem'
    ? '<span class="pr-verdict-main pr-verdict-main--enfermagem">🟢 ENFERMEIRO PODE FAZER (Enfermagem)</span>'
    : filaSug === 'Odontologia'
      ? '<span class="pr-verdict-main pr-verdict-main--odonto">🦷 DENTISTA PODE FAZER (Odontologia)</span>'
      : '<span class="pr-verdict-main pr-verdict-main--medico">🔵 SOMENTE MÉDICO PODE FAZER</span>';

  let statusPill = `<span class="pr-verdict-status-pill pr-status-info">🎯 Setor: ${escSafe(filaSug)}</span>`;
  let validadeCardCls = 'pr-verdict-card--info';
  let vencimentoHtml = `<div class="pr-vc-value">Setor sugerido: ${escSafe(filaSug)}</div><div class="pr-vc-sub">Validade padrão: ${escSafe(validadeTxt)}</div>`;

  if (clfServer && clfServer.data_vencimento) {
    const urgMap = {
      vencida: { cls: 'pr-status-vencida', cardCls: 'pr-verdict-card--danger', txt: '🔴 Receita Vencida', color: '#991b1b' },
      urgente: { cls: 'pr-status-urgente', cardCls: 'pr-verdict-card--warn', txt: `🟠 Vence em ${clfServer.dias_restantes}d`, color: '#92400e' },
      normal: { cls: 'pr-status-normal', cardCls: 'pr-verdict-card--ok', txt: `🟢 Válida (${clfServer.dias_restantes}d)`, color: '#166534' }
    };
    const u = urgMap[clfServer.urgencia] || { cls: 'pr-status-info', cardCls: 'pr-verdict-card--info', txt: '', color: '#0f172a' };
    statusPill = u.txt
      ? `<span class="pr-verdict-status-pill ${u.cls}">${escSafe(u.txt)}</span>`
      : `<span class="pr-verdict-status-pill pr-status-info">🎯 Setor: ${escSafe(filaSug)}</span>`;
    validadeCardCls = u.cardCls;
    vencimentoHtml = `<div class="pr-vc-value" style="font-size:17px;color:${u.color};">Vencimento: ${escSafe(clfServer.data_vencimento)}</div><div class="pr-vc-sub">Validade: ${escSafe(validadeTxt)}</div>`;
    box.dataset.dataVenc = clfServer.data_vencimento;
    box.dataset.diasRest = clfServer.dias_restantes ?? '';
    box.dataset.urgencia = clfServer.urgencia || 'normal';
  }

  const perfil = clfServer?.perfil_clinico;
  const perfilMeds = Array.isArray(perfil?.medicamentos_base) && perfil.medicamentos_base.length > 0
    ? ` (${escSafe(perfil.medicamentos_base.join(', '))})`
    : '';
  const perfilHtml = perfil?.label
    ? `<div><span class="pr-vc-pill" style="background:${perfil.hiperdia ? '#fef3c7' : '#f3e8ff'};color:${perfil.hiperdia ? '#92400e' : '#6b21a8'};border:1px solid ${perfil.hiperdia ? '#fcd34d' : '#d8b4fe'};">Perfil: ${escSafe(perfil.label)}</span>${perfilMeds ? `<span class="pr-vc-sub" style="display:inline-block;margin-top:4px;">${perfilMeds}</span>` : ''}</div>`
    : '';
  const motivoHtml = clfServer?.motivo_profissional
    ? `<div class="pr-vc-value" style="font-size:14px;">${escSafe(clfServer.motivo_profissional)}</div>`
    : (!perfil?.label ? `<div class="pr-vc-sub">Classificação aplicada pelo tipo de documento (${escSafe(filaSug)}).</div>` : '');

  const saldo = clfServer?.saldo_comprimidos;
  const saldoCardCls = saldo?.resumo
    ? (saldo.ainda_tem ? 'pr-verdict-card--ok' : 'pr-verdict-card--danger')
    : 'pr-verdict-card--info';
  const saldoHtml = saldo?.resumo
    ? `<div class="pr-vc-label">💊 Saldo de Comprimidos</div><div class="pr-vc-value" style="color:${saldo.ainda_tem ? '#166534' : '#991b1b'};">${escSafe(saldo.resumo)}</div>`
    : `<div class="pr-vc-label">🎯 Direcionamento</div><div class="pr-vc-value">${escSafe(filaSug)}</div><div class="pr-vc-sub">Confira a data de emissão ao lado para cálculo exato de validade e saldo.</div>`;

  box.innerHTML = `
    <div class="pr-verdict-head">
      <div class="pr-verdict-title-wrap">
        <span class="pr-verdict-kicker">${tipoRotulo}</span>
        ${profVerdict}
      </div>
      ${statusPill}
    </div>
    <div class="pr-verdict-cards">
      <div class="pr-verdict-card">
        <div class="pr-vc-label">🩺 Perfil &amp; Regra Clínica</div>
        ${perfilHtml}
        ${motivoHtml}
      </div>
      <div class="pr-verdict-card ${validadeCardCls}">
        <div class="pr-vc-label">📅 Validade &amp; Vencimento</div>
        ${vencimentoHtml}
      </div>
      <div class="pr-verdict-card ${saldoCardCls}">
        ${saldoHtml}
      </div>
    </div>`;

  box.dataset.filaSugerida = filaSug;
  box.style.display = 'block';
  if (clfServer) {
    const bodyEl = document.querySelector('#modal-captura-receita .previa-modal-body');
    if (bodyEl) bodyEl.scrollTop = 0;
  }
}

async function confirmarPreviaReceitaRecepcao(aplicarSetorSugerido = false) {
  const tipo_receita = document.getElementById('pr-tipo')?.value || 'branca';
  const paciente_nome_ocr = document.getElementById('pr-paciente-nome')?.value.trim() || '';
  const paciente_cns = document.getElementById('pr-paciente-cns')?.value.trim() || '';
  const paciente_cpf = document.getElementById('pr-paciente-cpf')?.value.trim() || '';
  const paciente_telefone = document.getElementById('pr-paciente-telefone')?.value.trim() || '';
  const paciente_cep = document.getElementById('pr-paciente-cep')?.value.trim() || '';
  const paciente_bairro = document.getElementById('pr-paciente-bairro')?.value.trim() || '';
  const medicamentos = document.getElementById('pr-medicamentos')?.value.trim() || '';
  const data_emissao = document.getElementById('pr-data-emissao')?.value.trim() || '';
  const medico_emitente = document.getElementById('pr-medico-emitente')?.value.trim() || '';
  const observacoes = document.getElementById('pr-observacoes')?.value.trim() || '';
  const box = document.getElementById('pr-sugestao-box');
  const fila_sugerida = box?.dataset?.filaSugerida || (tipo_receita === 'sisreg' ? 'Regulação' : tipo_receita === 'azul' ? 'Médico' : tipo_receita === 'odonto' ? 'Odontologia' : 'Médico');

  if (_previaAnexosCaptura.length === 0 && !medicamentos && !paciente_nome_ocr && !observacoes) {
    showToast('Anexe ao menos um arquivo (foto/PDF) ou informe os dados da prévia!', true);
    return;
  }

  const dadosExtrasFinal = { ...(_previaDadosExtrasAtual || {}) };
  if (paciente_cpf) dadosExtrasFinal.paciente_cpf = paciente_cpf;
  else delete dadosExtrasFinal.paciente_cpf;
  if (paciente_telefone) dadosExtrasFinal.paciente_telefone = paciente_telefone;
  if (paciente_cep) dadosExtrasFinal.paciente_cep = paciente_cep;
  if (paciente_bairro) dadosExtrasFinal.paciente_bairro = paciente_bairro;
  const temDadosExtras = Object.values(dadosExtrasFinal).some(v => v !== null && v !== undefined && v !== '');

  const payload = {
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
    dados_extras: temDadosExtras ? dadosExtrasFinal : null
  };

  if (_previaCapturaTargetPatient && _previaCapturaTargetPatient.id) {
    const pid = _previaCapturaTargetPatient.id;
    try {
      const res = await fetch(`${API_URL}/patients/${pid}/previa-receita`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error();
      fecharModalCapturaReceita();
      showToast('📎 Prévia salva no paciente!');
      if (typeof loadQueues === 'function') await loadQueues();
      if (typeof loadAcolhimentoFluxo === 'function') await loadAcolhimentoFluxo();
    } catch (_) {
      showToast('Erro ao salvar prévia no paciente.', true);
    }
    return;
  }

  window._previaReceitaPendente = payload;

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
  showToast(`📎 Prévia anexada (${qtd} arquivo${qtd === 1 ? '' : 's'})! Agora finalize clicando em Cadastrar.`);
}

// Paste (Ctrl+V) dentro do modal de captura
document.addEventListener('paste', (e) => {
  const modal = document.getElementById('modal-captura-receita');
  if (!modal || !modal.classList.contains('show')) return;
  const items = e.clipboardData?.items || [];
  const files = [];
  for (const item of items) {
    if (item.type && (item.type.startsWith('image/') || item.type === 'application/pdf')) {
      const f = item.getAsFile();
      if (f) files.push(f);
    }
  }
  if (files.length > 0) {
    e.preventDefault();
    processarListaImagensReceita(files);
  }
});

// ====== BADGES E VISUALIZAÇÃO NO CONSULTÓRIO ======
function renderPreviaReceitaBadgeLinha(p) {
  const pr = p?.previa_receita;
  if (!pr) return '';
  const meta = Array.isArray(pr.anexos_meta) ? pr.anexos_meta : [];
  const temEnc = meta.some(m => m?.categoria === 'encaminhamento');
  const temExm = meta.some(m => m?.categoria === 'exame');
  const temPdf = meta.some(m => m?.mime_type === 'application/pdf');
  const ehReg = pr.tipo_receita === 'sisreg' || p.setor === 'Regulação' || pr.dados_extras?.destino_ia === 'sisreg' || (!pr.medicamentos && temEnc);

  const tipoBadge = ehReg
    ? '<span class="previa-pill previa-pill-enc">📋 Prévia SISREG</span>'
    : pr.tipo_receita === 'azul'
      ? '<span class="previa-pill previa-pill-azul">🔵 Receita Azul</span>'
      : pr.tipo_receita === 'odonto'
        ? '<span class="previa-pill previa-pill-odonto">🦷 Receita Odonto</span>'
        : '<span class="previa-pill previa-pill-branca">⚪ Receita Branca</span>';

  let urgBadge = '';
  if (!ehReg) {
    if (pr.urgencia === 'vencida') {
      urgBadge = '<span class="previa-pill previa-pill-vencida">🔴 Vencida</span>';
    } else if (pr.urgencia === 'urgente') {
      const dTxt = pr.dias_restantes !== null && pr.dias_restantes !== undefined ? `${pr.dias_restantes}d` : 'logo';
      urgBadge = `<span class="previa-pill previa-pill-urgente">🟠 Vence em ${dTxt}</span>`;
    } else if (pr.data_vencimento) {
      urgBadge = `<span class="previa-pill previa-pill-ok">🟢 Válida até ${escSafe(pr.data_vencimento)}</span>`;
    }
  }

  const qtd = Number(pr.qtd_anexos) || meta.length || (pr.tem_imagem ? 1 : 0);
  const anexosBadge = qtd > 1
    ? `<span class="previa-pill previa-pill-anexos">📎 ${qtd} arquivos</span>`
    : '';
  const pdfBadge = temPdf ? '<span class="previa-pill previa-pill-exm">📄 PDF</span>' : '';
  const encBadge = (!ehReg && temEnc) ? '<span class="previa-pill previa-pill-enc">📋 Encaminhamento</span>' : '';
  const exmBadge = temExm ? '<span class="previa-pill previa-pill-exm">🧪 Exame</span>' : '';

  const revBadge = pr.status_revisao === 'revisada'
    ? '<span class="previa-pill previa-pill-pronta">✅ Pronta</span>'
    : '';

  const textoResumo = pr.medicamentos || pr.dados_extras?.especialidade || '';
  const iconeResumo = pr.medicamentos ? '💊' : '📋';
  const medPreview = textoResumo
    ? `<div class="previa-med-resumo">${iconeResumo} ${escSafe(String(textoResumo).slice(0, 90))}${String(textoResumo).length > 90 ? '...' : ''}</div>`
    : '';

  return `<div class="previa-row-box">${tipoBadge}${urgBadge}${pdfBadge}${anexosBadge}${encBadge}${exmBadge}${revBadge}${medPreview}</div>`;
}

function renderBotaoPreviaReceitaLinha(p, setor) {
  const safeNome = String(p?.nome || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
  const safeSetor = String(setor || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
  const testeTag = '<span class="previa-teste-tag" title="Liberado para teste">Teste</span>';
  if (setor === 'Regulação' && p?.id) {
    if (p.previa_receita) {
      const qtd = Number(p.previa_receita.qtd_anexos) || 0;
      const sufixo = qtd > 1 ? ` (${qtd})` : '';
      return `<button class="btn-previa-receita" style="background:linear-gradient(135deg,#0f766e,#0d9488);" onclick="event.stopPropagation();abrirPacienteNoCopilotoSisreg(${p.id},'${safeNome}',false)" title="Abrir Prévia SISREG (Liberado para teste)">👁️ Prévia${sufixo} ${testeTag}</button>`;
    }
    return `<button class="btn-previa-receita" style="background:linear-gradient(135deg,#1d4ed8,#1e40af);" onclick="event.stopPropagation();abrirPacienteNoCopilotoSisreg(${p.id},'${safeNome}',true)" title="Anexar foto ou PDF na Prévia SISREG (Liberado para teste)">📷 Prévia ${testeTag}</button>`;
  }
  if (!p?.id) return '';
  if (!p.previa_receita) {
    return `<button class="btn-previa-receita" style="background:linear-gradient(135deg,#475569,#334155);" onclick="event.stopPropagation();abrirModalCapturaReceitaPaciente(${p.id},'${safeNome}','${safeSetor}')" title="Prévia — Liberado para teste (anexe foto ou PDF)">📷 Prévia ${testeTag}</button>`;
  }
  const pronto = p.previa_receita.status_revisao === 'revisada';
  const qtd = Number(p.previa_receita.qtd_anexos) || 0;
  const sufixo = qtd > 1 ? ` (${qtd})` : '';
  return `<button class="btn-previa-receita ${pronto ? 'revisada' : ''}" onclick="event.stopPropagation();abrirModalVerPreviaReceita(${p.id},'${safeNome}','${safeSetor}')" title="Prévia — Liberado para teste (ver foto(s)/PDF e formulários)">${pronto ? '✅ Prévia' : '👁️ Prévia'}${sufixo} ${testeTag}</button>`;
}

function renderFotoAtivaPreviaModal() {
  const imgEl = document.getElementById('vp-img');
  const pdfFrame = document.getElementById('vp-pdf-frame');
  const imgControls = document.getElementById('vp-img-controls');
  const semImgEl = document.getElementById('vp-sem-img');
  const dlEl = document.getElementById('vp-btn-download');
  const navBar = document.getElementById('vp-nav-bar');
  const counterEl = document.getElementById('vp-foto-counter');
  const catBadge = document.getElementById('vp-foto-cat-badge');
  const strip = document.getElementById('vp-thumbs-strip');

  const total = _previaModalAnexos.length;
  if (_previaModalFotoIdx >= total) _previaModalFotoIdx = Math.max(0, total - 1);
  const ativo = total > 0 ? _previaModalAnexos[_previaModalFotoIdx] : null;
  const ehPdf = isPreviaAnexoPdf(ativo);

  resetPreviaImgView();
  revogarVpPdfBlobUrl();

  if (ativo && ehPdf && ativo.imagem_base64) {
    imgEl.style.display = 'none';
    semImgEl.style.display = 'none';
    if (imgControls) imgControls.style.display = 'none';
    if (pdfFrame) {
      const blobUrl = criarBlobUrlPdfPrevia(ativo.imagem_base64);
      _vpPdfBlobUrl = blobUrl;
      pdfFrame.src = blobUrl || ativo.imagem_base64;
      pdfFrame.style.display = 'block';
    }
    if (dlEl) {
      dlEl.href = ativo.imagem_base64;
      dlEl.download = ativo.nome_arquivo || `documento-${_previaModalFotoIdx + 1}.pdf`;
      dlEl.style.display = 'inline-flex';
    }
  } else if (ativo && ativo.imagem_base64) {
    if (pdfFrame) { pdfFrame.src = 'about:blank'; pdfFrame.style.display = 'none'; }
    if (imgControls) imgControls.style.display = 'flex';
    imgEl.src = ativo.imagem_base64;
    imgEl.style.display = 'block';
    semImgEl.style.display = 'none';
    if (dlEl) {
      dlEl.href = ativo.imagem_base64;
      dlEl.download = ativo.nome_arquivo || `documento-${_previaModalFotoIdx + 1}.jpg`;
      dlEl.style.display = 'inline-flex';
    }
  } else {
    if (pdfFrame) { pdfFrame.src = 'about:blank'; pdfFrame.style.display = 'none'; }
    if (imgControls) imgControls.style.display = 'none';
    imgEl.style.display = 'none';
    semImgEl.style.display = 'flex';
    semImgEl.textContent = '📄 Prévia registrada apenas em texto (sem arquivo anexado)';
    if (dlEl) dlEl.style.display = 'none';
  }

  if (navBar) {
    navBar.style.display = total > 0 ? 'flex' : 'none';
    if (counterEl) counterEl.textContent = `Arquivo ${_previaModalFotoIdx + 1} de ${total}${ehPdf ? ' · 📄 PDF' : ''}`;
    if (catBadge && ativo) {
      const cat = normalizarCategoriaAnexoFront(ativo.categoria);
      catBadge.textContent = `${ehPdf ? '📄 PDF · ' : ''}${CATEGORIAS_ANEXO_LABEL[cat] || '📄 Documento'}${ativo.rotulo && ativo.rotulo !== 'PDF' ? ' · ' + ativo.rotulo : ''}`;
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
        const isP = isPreviaAnexoPdf(a);
        const cat = normalizarCategoriaAnexoFront(a.categoria);
        const icone = isP ? '📄' : (cat === 'receita_azul' ? '🔵' : cat === 'encaminhamento' ? '📋' : cat === 'exame' ? '🧪' : cat === 'odonto' ? '🦷' : '⚪');
        const thumbBody = isP
          ? `<div class="pr-thumb-pdf-mini">📄</div>`
          : `<img src="${a.imagem_base64}" alt="Arquivo ${idx + 1}">`;
        return `<button type="button" class="vp-thumb-btn${idx === _previaModalFotoIdx ? ' active' : ''}" onclick="selecionarFotoPrevia(${idx})">
          ${thumbBody}
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
  const btnLab = document.getElementById('vp-btn-form-lab');
  const btnCito = document.getElementById('vp-btn-form-cito');
  if (btnCito) {
    btnCito.style.display = 'inline-flex';
  }
  if (btnRec && btnEsp && btnAmb) {
    const tipoGeral = window._previaModalDadosAtuais?.previa?.tipo_receita;
    const isExm = catAtiva === 'exame';
    const isEnc = catAtiva === 'encaminhamento';
    const isAzul = catAtiva === 'receita_azul' || (!catAtiva && tipoGeral === 'azul');
    if (btnLab) btnLab.classList.toggle('destaque', isExm);
    btnAmb.classList.toggle('destaque', isEnc);
    btnEsp.classList.toggle('destaque', !isExm && !isEnc && isAzul);
    btnRec.classList.toggle('destaque', !isExm && !isEnc && !isAzul);
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
  const paciente = typeof buscarPacienteNaMemoria === 'function'
    ? buscarPacienteNaMemoria(patientId, setor)
    : null;
  const profDirecionado = typeof obterProfissionalSelecionadoSetor === 'function'
    ? obterProfissionalSelecionadoSetor(setor, paciente)
    : String(paciente?.profissional_destino || paciente?.profissional || paciente?.medico || '').trim();
  const setorExibicao = (paciente?.etapa_fluxo === 'segunda_escuta' || (setor === 'Acolhimento' && profDirecionado))
    ? `${setor} (2ª Escuta)`
    : setor;

  window._previaModalDadosAtuais = {
    patientId,
    nomePaciente,
    setor,
    paciente,
    profissionalDirecionado: profDirecionado || '',
    previa: null,
    anexos: [],
    activeIdx: 0
  };
  inicializarPanZoomPreviaModal();

  const profRow = document.getElementById('vp-prof-direcionado-row');
  const profValEl = document.getElementById('vp-prof-direcionado');
  if (profRow && profValEl) {
    if (profDirecionado) {
      profValEl.textContent = profDirecionado;
      profRow.style.display = 'block';
    } else {
      profValEl.textContent = '—';
      profRow.style.display = 'none';
    }
  }

  document.getElementById('vp-titulo').textContent = `📄 Prévia de Documentos — ${nomePaciente}`;
  document.getElementById('vp-subtitulo').textContent = `Setor: ${setorExibicao}${profDirecionado ? ` · 👨‍⚕️ ${profDirecionado}` : ''} · Carregando dados...`;
  document.getElementById('vp-img').src = '';
  document.getElementById('vp-img').style.display = 'none';
  document.getElementById('vp-sem-img').style.display = 'flex';
  document.getElementById('vp-sem-img').textContent = '⏳ Carregando arquivo...';
  const navBar = document.getElementById('vp-nav-bar');
  const strip = document.getElementById('vp-thumbs-strip');
  if (navBar) navBar.style.display = 'none';
  if (strip) { strip.style.display = 'none'; strip.innerHTML = ''; }

  const formsBox = document.getElementById('vp-formularios-box');
  if (formsBox) {
    formsBox.style.display = 'block';
  }
  const btnSisregVp = document.getElementById('vp-btn-copiloto-sisreg');
  if (btnSisregVp) {
    btnSisregVp.style.display = ['Regulação', 'Médico', 'Enfermagem', 'Odontologia', 'Acolhimento'].includes(setor) ? 'inline-flex' : 'none';
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
      paciente,
      profissionalDirecionado: profDirecionado || '',
      previa: pr,
      anexos: _previaModalAnexos,
      activeIdx: 0
    };

    const totalTxt = _previaModalAnexos.length > 1 ? ` · 📎 ${_previaModalAnexos.length} arquivos` : '';
    const profTxt = profDirecionado ? ` · 👨‍⚕️ ${profDirecionado}` : '';
    document.getElementById('vp-subtitulo').textContent = `Setor: ${setorExibicao}${profTxt}${totalTxt}${pr.status_revisao === 'revisada' ? ' · ✅ Marcada como pronta' : ' · ⏳ Aguardando revisão'}`;
    document.getElementById('vp-nome-pac').textContent = pr.paciente_nome_ocr || nomePaciente;
    document.getElementById('vp-cns').textContent = pr.paciente_cns || pr.dados_extras?.paciente_cpf || 'Não identificado';
    const contatoRow = document.getElementById('vp-contato-row');
    if (contatoRow) {
      const extVp = pr.dados_extras && typeof pr.dados_extras === 'object' ? pr.dados_extras : {};
      const partesContato = [];
      if (extVp.paciente_cpf) partesContato.push(`<b>CPF:</b> ${escSafe(extVp.paciente_cpf)}`);
      if (extVp.paciente_telefone) partesContato.push(`<b>Tel:</b> ${escSafe(extVp.paciente_telefone)}`);
      if (extVp.paciente_bairro) partesContato.push(`<b>Bairro:</b> ${escSafe(extVp.paciente_bairro)}`);
      if (extVp.paciente_cep) partesContato.push(`<b>CEP:</b> ${escSafe(extVp.paciente_cep)}`);
      if (partesContato.length > 0) {
        contatoRow.innerHTML = partesContato.join(' &nbsp;·&nbsp; ');
        contatoRow.style.display = 'block';
      } else {
        contatoRow.innerHTML = '';
        contatoRow.style.display = 'none';
      }
    }
    document.getElementById('vp-tipo').textContent = pr.tipo_receita === 'sisreg'
      ? '📋 SISREG / Encaminhamento'
      : pr.tipo_receita === 'azul'
        ? '🔵 Azul (Controle Especial)'
        : pr.tipo_receita === 'odonto'
          ? '🦷 Odontológica'
          : '⚪ Branca (PEC)';
    document.getElementById('vp-emissao').textContent = pr.data_emissao || 'Não informada';
    document.getElementById('vp-vencimento').textContent = pr.data_vencimento
      ? `${pr.data_vencimento}${pr.dias_restantes !== null && pr.dias_restantes !== undefined ? ` (${pr.dias_restantes < 0 ? 'Vencida' : pr.dias_restantes + ' dias'})` : ''}`
      : '—';
    document.getElementById('vp-medico').textContent = pr.medico_emitente || 'Não informado';
    document.getElementById('vp-medicamentos').textContent = pr.medicamentos || pr.dados_extras?.especialidade || 'Nenhum item extraído';
    document.getElementById('vp-obs').textContent = pr.observacoes || pr.dados_extras?.justificativa || 'Sem observações';

    const destBanner = document.getElementById('vp-destino-ia-banner');
    if (destBanner) {
      const ehSis = pr.tipo_receita === 'sisreg' || pr.dados_extras?.destino_ia === 'sisreg';
      if (ehSis) {
        destBanner.style.display = 'block';
        destBanner.innerHTML = `<strong>📋 Documento de Regulação / SISREG</strong>${pr.dados_extras?.especialidade ? `: ${escSafe(pr.dados_extras.especialidade)}` : ''}.`;
      } else {
        destBanner.style.display = 'none';
      }
    }

    renderFotoAtivaPreviaModal();

    const btnRev = document.getElementById('vp-btn-revisar');
    if (btnRev) {
      btnRev.textContent = pr.status_revisao === 'revisada'
        ? '↩️ Marcar como Pendente'
        : (setor === 'Farmácia' ? '✅ Conferida na Farmácia' : setor === 'Acolhimento' ? '✅ Marcar Conferida' : '✅ Marcar Receita Pronta');
      btnRev.classList.toggle('btn-revisada-ativo', pr.status_revisao === 'revisada');
    }
  } catch (err) {
    document.getElementById('vp-sem-img').textContent = '❌ Não foi possível carregar os dados desta prévia.';
  }
}

function fecharModalVerPreviaReceita() {
  document.getElementById('modal-ver-previa-receita')?.classList.remove('show');
  revogarVpPdfBlobUrl();
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

function editarPreviaDoModalVer() {
  const ctx = window._previaModalDadosAtuais || {};
  const pid = ctx.patientId;
  const nome = ctx.nomePaciente || '';
  const setor = ctx.setor || '';
  fecharModalVerPreviaReceita();
  if (pid && typeof abrirModalCapturaReceitaPaciente === 'function') {
    abrirModalCapturaReceitaPaciente(pid, nome, setor);
  }
}

async function alternarStatusRevisaoPrevia() {
  if (!_previaModalPacienteId) return;
  const novoStatus = _previaModalStatusAtual === 'revisada' ? 'pendente' : 'revisada';
  const setor = window._previaModalDadosAtuais?.setor || '';
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
      btnRev.textContent = novoStatus === 'revisada'
        ? '↩️ Marcar como Pendente'
        : (setor === 'Farmácia' ? '✅ Conferida na Farmácia' : setor === 'Acolhimento' ? '✅ Marcar Conferida' : '✅ Marcar Receita Pronta');
      btnRev.classList.toggle('btn-revisada-ativo', novoStatus === 'revisada');
    }
    showToast(novoStatus === 'revisada' ? '✅ Prévia marcada como conferida/pronta!' : '⏳ Prévia voltou para pendente.');
    if (typeof loadQueues === 'function') await loadQueues();
    if (typeof loadAcolhimentoFluxo === 'function') await loadAcolhimentoFluxo();
  } catch {
    showToast('Erro ao atualizar status da prévia.', true);
  }
}

function abrirCopilotoDaPrevia() {
  const ctx = window._previaModalDadosAtuais || {};
  const pid = ctx.patientId;
  const nome = ctx.nomePaciente || '';
  const setor = ctx.setor || '';
  fecharModalVerPreviaReceita();
  if (setor === 'Regulação' && pid && typeof abrirPacienteNoCopilotoSisreg === 'function') {
    abrirPacienteNoCopilotoSisreg(pid, nome, false);
  } else if (typeof abrirModalSisregConsulta === 'function') {
    const termo = ctx.previa?.dados_extras?.especialidade || '';
    abrirModalSisregConsulta(setor || 'Médico', 'busca', termo);
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const isShow = (id) => document.getElementById(id)?.classList.contains('show');
  if (isShow('modal-sisreg-medico') && typeof fecharModalSisregMedico === 'function') {
    fecharModalSisregMedico();
  } else if (isShow('modal-formulario-oficial') && typeof fecharModalFormularioOficial === 'function') {
    fecharModalFormularioOficial();
  } else if (isShow('modal-previa-regulacao') && typeof fecharModalPreviaRegulacao === 'function') {
    fecharModalPreviaRegulacao();
  } else if (isShow('modal-ver-previa-receita')) {
    fecharModalVerPreviaReceita();
  } else if (isShow('modal-captura-receita')) {
    fecharModalCapturaReceita();
  }
});
