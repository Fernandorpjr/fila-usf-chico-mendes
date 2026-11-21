// Módulo Frontend — Formulários SUS/Recife (PEC Offline & Renovação de Receita)
const UNIDADE_PADRAO_USF = 'US 177 USF CHICO MENDES';
const CNES_PADRAO_USF = '0000965';
const SETORES_FORMULARIOS_PEC = ['Médico', 'Enfermagem', 'Odontologia', 'ACS', 'Recepção', 'Regulação'];
const SETORES_CLINICOS_FILA = ['Médico', 'Enfermagem', 'Odontologia'];

const FORMULARIOS_PEC_REG = {
  'receituario': {
    url: '/formularios/receituario.html',
    titulo: '📄 Receituário (2 vias espelhadas)',
    shortLabel: '📄 Receituário',
    icon: '📄'
  },
  'controle-especial': {
    url: '/formularios/receituario-controle-especial.html',
    titulo: '🔵 Receituário de Controle Especial (2 vias espelhadas)',
    shortLabel: '🔵 Controle Especial',
    icon: '🔵'
  },
  'exames-laboratoriais': {
    url: '/formularios/receituario-exames-laboratoriais.html',
    titulo: '🧪 Receituário para Exames Laboratoriais',
    shortLabel: '🧪 Exames Lab.',
    icon: '🧪'
  },
  'ficha-ambulatorial': {
    url: '/formularios/ficha-solicitacao-ambulatorial.html',
    titulo: '📋 Ficha de Solicitação Ambulatorial',
    shortLabel: '📋 Ficha Ambulatorial',
    icon: '📋'
  },
  'citopatologico': {
    url: '/formularios/requisicao-exame-citopatologico.html',
    titulo: '🔬 Requisição de Exame Citopatológico',
    shortLabel: '🔬 Citopatológico',
    icon: '🔬'
  },
  'declaracao-residencia': {
    url: '/formularios/declaracao-residencia.html',
    titulo: '🏠 Declaração de Residência (ACS)',
    shortLabel: '🏠 Decl. Residência',
    icon: '🏠'
  }
};

const FORMULARIOS_POR_SETOR = {
  'Médico': ['receituario', 'controle-especial', 'exames-laboratoriais', 'ficha-ambulatorial', 'citopatologico'],
  'Enfermagem': ['receituario', 'citopatologico', 'exames-laboratoriais', 'ficha-ambulatorial', 'controle-especial'],
  'Odontologia': ['receituario', 'controle-especial', 'ficha-ambulatorial', 'exames-laboratoriais'],
  'ACS': ['declaracao-residencia'],
  'Recepção': ['declaracao-residencia'],
  'Regulação': ['ficha-ambulatorial', 'declaracao-residencia']
};

const FORMULARIOS_LINHA_FILA = {
  'Médico': ['receituario', 'controle-especial', 'exames-laboratoriais', 'ficha-ambulatorial'],
  'Enfermagem': ['receituario', 'citopatologico', 'exames-laboratoriais', 'ficha-ambulatorial'],
  'Odontologia': ['receituario', 'controle-especial', 'ficha-ambulatorial', 'exames-laboratoriais']
};

let _foEstadoAtual = {
  tipo: 'receituario',
  modo: 'preencher',
  setor: 'Médico',
  acsNome: '',
  paciente: null,
  previa: null,
  anexos: [],
  refIdx: 0,
  payload: null
};

let _foRefState = { zoom: 1, rot: 0, panX: 0, panY: 0 };

function obterDataHojeRecife() {
  try {
    const parts = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Recife',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(new Date()).split('/');
    const dd = parts[0] || '';
    const mm = parts[1] || '';
    const aa = parts[2] || '';
    return { dd, mm, aa, data_br: `${dd}/${mm}/${aa}` };
  } catch (_) {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const aa = String(d.getFullYear());
    return { dd, mm, aa, data_br: `${dd}/${mm}/${aa}` };
  }
}

function obterProfissionalSelecionadoSetor(setor, paciente) {
  if (paciente?.medico && String(paciente.medico).trim()) {
    return String(paciente.medico).trim();
  }
  if (paciente?.profissional && String(paciente.profissional).trim()) {
    return String(paciente.profissional).trim();
  }
  if (typeof SECTOR_CONFIG !== 'undefined' && SECTOR_CONFIG[setor]) {
    const key = SECTOR_CONFIG[setor].key;
    const sel = document.getElementById(`profissional-${key}`);
    if (sel && sel.value) return sel.value;
    if (typeof sectorFilters !== 'undefined' && sectorFilters[key]) return sectorFilters[key];
    if (Array.isArray(SECTOR_CONFIG[setor].profissionais) && SECTOR_CONFIG[setor].profissionais[0]) {
      return SECTOR_CONFIG[setor].profissionais[0];
    }
  }
  return '';
}

function montarPrescricaoTextoFonte(fonte) {
  if (!fonte || typeof fonte !== 'object') return '';
  const ext = fonte.dados_extras && typeof fonte.dados_extras === 'object' ? fonte.dados_extras : {};
  const posologia = ext.medicamentos_posologia || fonte.medicamentos_posologia;
  if (posologia && String(posologia).trim()) {
    return String(posologia).trim();
  }
  const meds = String(fonte.medicamentos || fonte.medicamento || '').trim();
  const obs = String(fonte.observacoes || '').trim();
  const linhas = [];
  if (meds) {
    meds.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean).forEach((m, idx) => {
      linhas.push(`${idx + 1}) ${m}`);
    });
  }
  if (obs && (!meds || !meds.toLowerCase().includes(obs.toLowerCase()))) {
    linhas.push(`Obs: ${obs}`);
  }
  return linhas.join('\n');
}

function montarJustificativaClinica(paciente, extraJustificativa) {
  const partes = [];
  if (extraJustificativa && String(extraJustificativa).trim()) {
    partes.push(String(extraJustificativa).trim());
  }
  if (paciente) {
    const m1 = String(paciente.motivo_primeira_escuta || '').trim();
    const m2 = String(paciente.observacao_segunda_escuta || '').trim();
    if (m1) partes.push(`1ª Escuta: ${m1}`);
    if (m2) partes.push(`2ª Escuta: ${m2}`);
  }
  return partes.join('\n');
}

function montarPayloadFormulario({ modo, setor, acsNome, paciente, previa, anexoAtivo, tipoForm }) {
  const hoje = obterDataHojeRecife();
  const ext = previa?.dados_extras && typeof previa.dados_extras === 'object' ? previa.dados_extras : {};
  const ocrAtivo = anexoAtivo?.ocr && typeof anexoAtivo.ocr === 'object' ? anexoAtivo.ocr : null;

  let prescricao = '';
  if ((tipoForm === 'receituario' || tipoForm === 'controle-especial') && ocrAtivo) {
    const prescAtiva = montarPrescricaoTextoFonte(ocrAtivo);
    prescricao = prescAtiva || montarPrescricaoTextoFonte(previa);
  } else {
    prescricao = montarPrescricaoTextoFonte(previa);
  }

  const especialidade = ocrAtivo?.especialidade || ext.especialidade || '';
  const hipotese_diagnostica = ocrAtivo?.hipotese_diagnostica || ext.hipotese_diagnostica || '';
  const cid10 = ocrAtivo?.cid10 || ext.cid10 || '';
  const justificativaExtra = ocrAtivo?.justificativa || ext.justificativa || '';

  return {
    modo: modo === 'branco' ? 'branco' : 'preencher',
    cnes: CNES_PADRAO_USF,
    unidade: UNIDADE_PADRAO_USF,
    profissional: obterProfissionalSelecionadoSetor(setor, paciente),
    acs_nome: acsNome || paciente?.acs_responsavel || '',
    data_dd: hoje.dd,
    data_mm: hoje.mm,
    data_aa: hoje.aa,
    data_br: hoje.data_br,
    paciente_nome: previa?.paciente_nome_ocr || paciente?.nome || '',
    paciente_idade: paciente?.idade !== undefined && paciente?.idade !== null ? String(paciente.idade) : '',
    paciente_cns: previa?.paciente_cns || '',
    paciente_endereco: ext.paciente_endereco || '',
    paciente_dn: ext.paciente_data_nascimento || '',
    paciente_sexo: ext.paciente_sexo || '',
    paciente_telefone: ext.paciente_telefone || '',
    paciente_mae: ext.paciente_mae || '',
    prescricao,
    especialidade,
    hipotese_diagnostica,
    cid10,
    justificativa: montarJustificativaClinica(paciente, justificativaExtra)
  };
}

function buscarPacienteNaMemoria(patientId, setor) {
  const pid = Number(patientId);
  if (typeof queues !== 'undefined' && queues && Array.isArray(queues[setor])) {
    const found = queues[setor].find(p => Number(p.id) === pid);
    if (found) return found;
  }
  if (typeof queues !== 'undefined' && queues) {
    for (const s of Object.keys(queues)) {
      const found = (queues[s] || []).find(p => Number(p.id) === pid);
      if (found) return found;
    }
  }
  if (typeof attendedPatients !== 'undefined' && Array.isArray(attendedPatients)) {
    const found = attendedPatients.find(p => Number(p.id) === pid);
    if (found) return found;
  }
  return null;
}

function normalizarListaAnexosFormulario(contexto, previa) {
  if (Array.isArray(contexto.anexos) && contexto.anexos.length > 0) {
    return contexto.anexos.filter(a => a && a.imagem_base64);
  }
  if (Array.isArray(previa?.anexos) && previa.anexos.length > 0) {
    return previa.anexos.filter(a => a && a.imagem_base64);
  }
  const img = contexto.imagemAntiga || previa?.imagem_base64 || null;
  if (img) {
    return [{ id: 'anx_1', categoria: previa?.tipo_receita || 'branca', rotulo: null, imagem_base64: img, ocr: null }];
  }
  return [];
}

function renderFotoRefFormularioModal() {
  const btnFoto = document.getElementById('fo-btn-ver-foto');
  const paneFoto = document.getElementById('fo-ref-pane');
  const imgFoto = document.getElementById('fo-ref-img');
  const nav = document.getElementById('fo-ref-nav');
  const cnt = document.getElementById('fo-ref-counter');

  const anexos = _foEstadoAtual.anexos || [];
  if (anexos.length === 0) {
    if (btnFoto) btnFoto.style.display = 'none';
    if (paneFoto) paneFoto.classList.remove('show');
    if (imgFoto) imgFoto.src = '';
    if (nav) nav.style.display = 'none';
    return;
  }

  if (_foEstadoAtual.refIdx >= anexos.length) _foEstadoAtual.refIdx = Math.max(0, anexos.length - 1);
  const ativo = anexos[_foEstadoAtual.refIdx];

  if (btnFoto) {
    btnFoto.style.display = 'inline-flex';
    btnFoto.textContent = anexos.length > 1 ? `👁️ Fotos (${anexos.length})` : '👁️ Foto Antiga';
  }
  if (imgFoto) imgFoto.src = ativo.imagem_base64 || '';
  if (nav && cnt) {
    nav.style.display = anexos.length > 1 ? 'inline-flex' : 'none';
    cnt.textContent = `${_foEstadoAtual.refIdx + 1}/${anexos.length}`;
  }
  resetRefFotoForm();
}

function navegarRefFotoForm(delta) {
  const total = (_foEstadoAtual.anexos || []).length;
  if (total <= 1) return;
  _foEstadoAtual.refIdx = (_foEstadoAtual.refIdx + delta + total) % total;
  renderFotoRefFormularioModal();
}

function atualizarUITopoModalFormulario() {
  const info = FORMULARIOS_PEC_REG[_foEstadoAtual.tipo] || FORMULARIOS_PEC_REG.receituario;
  const tit = document.getElementById('fo-titulo');
  const sub = document.getElementById('fo-subtitulo');
  if (tit) tit.textContent = info.titulo;
  if (sub) {
    const pacNome = _foEstadoAtual.payload?.paciente_nome || _foEstadoAtual.paciente?.nome;
    const modoTxt = _foEstadoAtual.modo === 'branco' ? 'Em Branco (Manual)' : (pacNome ? `Paciente: ${pacNome}` : `Avulso (${_foEstadoAtual.setor})`);
    sub.textContent = `${_foEstadoAtual.setor} · ${modoTxt}`;
  }

  const permitidos = FORMULARIOS_POR_SETOR[_foEstadoAtual.setor] || FORMULARIOS_POR_SETOR['Médico'];
  Object.keys(FORMULARIOS_PEC_REG).forEach(k => {
    const btn = document.getElementById(`fo-tab-${k}`);
    if (btn) {
      const visivel = permitidos.includes(k) || k === _foEstadoAtual.tipo;
      btn.style.display = visivel ? 'inline-flex' : 'none';
      btn.classList.toggle('active', k === _foEstadoAtual.tipo);
    }
  });

  const btnPreencher = document.getElementById('fo-btn-preencher');
  if (btnPreencher) {
    const temContexto = Boolean(_foEstadoAtual.paciente || _foEstadoAtual.previa || _foEstadoAtual.modo === 'preencher');
    btnPreencher.style.display = temContexto ? 'inline-flex' : 'none';
  }
  const btnSisregFo = document.getElementById('fo-btn-sisreg');
  if (btnSisregFo) {
    btnSisregFo.style.display = _foEstadoAtual.tipo === 'ficha-ambulatorial' ? 'inline-flex' : 'none';
  }

  renderFotoRefFormularioModal();
}

function enviarPayloadAoIframe() {
  const iframe = document.getElementById('fo-iframe');
  if (!iframe || !iframe.contentWindow) return;
  try {
    if (_foEstadoAtual.modo === 'branco') {
      iframe.contentWindow.postMessage({ type: 'FORM_BRANCO' }, window.location.origin);
    } else if (_foEstadoAtual.payload) {
      iframe.contentWindow.postMessage({ type: 'FORM_PREENCHER', payload: _foEstadoAtual.payload }, window.location.origin);
    }
  } catch (_) {}
}

function abrirFormularioOficial(tipoForm, contexto = {}) {
  const setor = SETORES_FORMULARIOS_PEC.includes(contexto.setor) ? contexto.setor : 'Médico';
  const permitidos = FORMULARIOS_POR_SETOR[setor] || FORMULARIOS_POR_SETOR['Médico'];
  const tipo = FORMULARIOS_PEC_REG[tipoForm] ? tipoForm : permitidos[0];

  const modo = contexto.modo === 'branco' ? 'branco' : 'preencher';
  const paciente = contexto.paciente || null;
  const previa = contexto.previa || paciente?.previa_receita || null;
  const anexos = normalizarListaAnexosFormulario(contexto, previa);
  const refIdx = Number.isInteger(contexto.refIdx) && contexto.refIdx >= 0 && contexto.refIdx < anexos.length ? contexto.refIdx : 0;
  const anexoAtivo = anexos[refIdx] || null;
  const acsNome = contexto.acsNome || '';

  _foEstadoAtual = {
    tipo,
    modo,
    setor,
    acsNome,
    paciente,
    previa,
    anexos,
    refIdx,
    payload: montarPayloadFormulario({ modo, setor, acsNome, paciente, previa, anexoAtivo, tipoForm: tipo })
  };

  atualizarUITopoModalFormulario();
  inicializarPanZoomRefFormulario();

  const paneFoto = document.getElementById('fo-ref-pane');
  if (paneFoto) paneFoto.classList.remove('show');

  const iframe = document.getElementById('fo-iframe');
  const modal = document.getElementById('modal-formulario-oficial');
  if (!iframe || !modal) return;

  const targetUrl = FORMULARIOS_PEC_REG[tipo].url;
  modal.classList.add('show');

  const currentPath = (() => {
    try { return iframe.contentWindow?.location?.pathname || ''; } catch (_) { return ''; }
  })();

  if (currentPath === targetUrl) {
    enviarPayloadAoIframe();
  } else {
    iframe.onload = () => enviarPayloadAoIframe();
    iframe.src = targetUrl;
  }
}

function abrirFormularioDaPrevia(tipoForm) {
  const ctx = window._previaModalDadosAtuais || {};
  const setor = ctx.setor || 'Médico';
  const paciente = ctx.patientId ? buscarPacienteNaMemoria(ctx.patientId, setor) : null;
  const previa = ctx.previa || paciente?.previa_receita || null;
  const pacienteFinal = paciente || (ctx.nomePaciente ? { id: ctx.patientId, nome: ctx.nomePaciente } : null);
  const anexos = Array.isArray(ctx.anexos) && ctx.anexos.length > 0 ? ctx.anexos : (previa?.anexos || []);
  const refIdx = Number.isInteger(ctx.activeIdx) ? ctx.activeIdx : 0;

  abrirFormularioOficial(tipoForm, {
    modo: 'preencher',
    setor,
    paciente: pacienteFinal,
    previa,
    anexos,
    refIdx
  });
}

async function abrirFormularioPacienteFila(patientId, setor, tipoForm) {
  let paciente = buscarPacienteNaMemoria(patientId, setor);
  let previa = paciente?.previa_receita || null;
  if (previa && (!Array.isArray(previa.anexos) || previa.anexos.length === 0) && !previa.imagem_base64) {
    try {
      const r = await fetch(`${API_URL}/patients/${patientId}/previa-receita`, { cache: 'no-store' });
      if (r.ok) previa = await r.json();
    } catch (_) {}
  }
  abrirFormularioOficial(tipoForm, {
    modo: 'preencher',
    setor,
    paciente,
    previa
  });
}

function abrirFormularioAvulsoSetor(setor, tipoForm, emBranco = false) {
  abrirFormularioOficial(tipoForm, {
    modo: emBranco ? 'branco' : 'preencher',
    setor,
    paciente: null,
    previa: null
  });
}

function abrirDeclaracaoResidenciaAcs(acsNome = '', emBranco = false) {
  abrirFormularioOficial('declaracao-residencia', {
    modo: emBranco ? 'branco' : 'preencher',
    setor: 'ACS',
    acsNome: acsNome || '',
    paciente: null,
    previa: null
  });
}

function abrirDeclaracaoResidenciaRecepcao(emBranco = false) {
  const nomePac = document.getElementById('input-nome')?.value.trim() || '';
  const previaPendente = window._previaReceitaPendente || null;
  abrirFormularioOficial('declaracao-residencia', {
    modo: emBranco ? 'branco' : 'preencher',
    setor: 'Recepção',
    paciente: nomePac ? { nome: nomePac } : null,
    previa: previaPendente
  });
}

function trocarTipoFormularioModal(tipoForm) {
  if (!FORMULARIOS_PEC_REG[tipoForm]) return;
  abrirFormularioOficial(tipoForm, {
    modo: _foEstadoAtual.modo,
    setor: _foEstadoAtual.setor,
    acsNome: _foEstadoAtual.acsNome,
    paciente: _foEstadoAtual.paciente,
    previa: _foEstadoAtual.previa,
    anexos: _foEstadoAtual.anexos,
    refIdx: _foEstadoAtual.refIdx
  });
}

function imprimirFormularioOficial() {
  const iframe = document.getElementById('fo-iframe');
  if (!iframe || !iframe.contentWindow) return;
  try {
    const cw = iframe.contentWindow;
    if (typeof cw.copiar === 'function') {
      const chk = cw.document?.getElementById('chk-espelhar');
      if (!chk || chk.checked) cw.copiar();
    }
    cw.focus();
    cw.print();
  } catch (_) {
    try { iframe.contentWindow.postMessage({ type: 'FORM_IMPRIMIR' }, window.location.origin); } catch (__) {}
  }
}

function deixarFormularioEmBranco() {
  _foEstadoAtual.modo = 'branco';
  atualizarUITopoModalFormulario();
  const iframe = document.getElementById('fo-iframe');
  if (iframe?.contentWindow) {
    try { iframe.contentWindow.postMessage({ type: 'FORM_BRANCO' }, window.location.origin); } catch (_) {}
  }
}

function reaplicarDadosFormularioModal() {
  _foEstadoAtual.modo = 'preencher';
  const anexoAtivo = (_foEstadoAtual.anexos || [])[_foEstadoAtual.refIdx] || null;
  _foEstadoAtual.payload = montarPayloadFormulario({
    modo: 'preencher',
    setor: _foEstadoAtual.setor,
    acsNome: _foEstadoAtual.acsNome,
    paciente: _foEstadoAtual.paciente,
    previa: _foEstadoAtual.previa,
    anexoAtivo,
    tipoForm: _foEstadoAtual.tipo
  });
  atualizarUITopoModalFormulario();
  enviarPayloadAoIframe();
}

function toggleFotoAntigaFormulario() {
  const pane = document.getElementById('fo-ref-pane');
  if (!pane) return;
  pane.classList.toggle('show');
  if (pane.classList.contains('show')) inicializarPanZoomRefFormulario();
}

function abrirFormularioNovaAba() {
  const info = FORMULARIOS_PEC_REG[_foEstadoAtual.tipo] || FORMULARIOS_PEC_REG.receituario;
  const win = window.open(info.url, '_blank');
  if (win && _foEstadoAtual.modo !== 'branco' && _foEstadoAtual.payload) {
    const enviarQuandoPronto = (e) => {
      if (e.source === win && e.data?.type === 'FORM_PRONTO') {
        win.postMessage({ type: 'FORM_PREENCHER', payload: _foEstadoAtual.payload }, window.location.origin);
        window.removeEventListener('message', enviarQuandoPronto);
      }
    };
    window.addEventListener('message', enviarQuandoPronto);
    setTimeout(() => window.removeEventListener('message', enviarQuandoPronto), 15000);
  }
}

function fecharModalFormularioOficial() {
  document.getElementById('modal-formulario-oficial')?.classList.remove('show');
}

function aplicarTransformRefFotoForm() {
  const img = document.getElementById('fo-ref-img');
  if (img) {
    img.style.transform = `translate(${_foRefState.panX}px, ${_foRefState.panY}px) scale(${_foRefState.zoom}) rotate(${_foRefState.rot}deg)`;
  }
}

function zoomRefFotoForm(delta) {
  _foRefState.zoom = Math.max(0.5, Math.min(4.5, Number((_foRefState.zoom + delta).toFixed(2))));
  aplicarTransformRefFotoForm();
}

function girarRefFotoForm() {
  _foRefState.rot = (_foRefState.rot + 90) % 360;
  aplicarTransformRefFotoForm();
}

function resetRefFotoForm() {
  _foRefState = { zoom: 1, rot: 0, panX: 0, panY: 0 };
  aplicarTransformRefFotoForm();
}

function inicializarPanZoomRefFormulario() {
  if (typeof window.initPreviaPanZoom !== 'function') return;
  window.initPreviaPanZoom(
    'fo-ref-stage',
    'fo-ref-img',
    () => _foRefState,
    (patch) => { Object.assign(_foRefState, patch); },
    aplicarTransformRefFotoForm
  );
}

window.addEventListener('message', (e) => {
  if (e.origin !== window.location.origin || !e.data || typeof e.data !== 'object') return;
  if (e.data.type === 'FORM_PRONTO') {
    const iframe = document.getElementById('fo-iframe');
    if (iframe && e.source === iframe.contentWindow) {
      enviarPayloadAoIframe();
    }
  } else if (e.data.type === 'FORM_TOAST' && e.data.msg) {
    if (typeof showToast === 'function') showToast(e.data.msg);
  }
});

function renderBarraFormulariosSetor(setor) {
  if (!SETORES_CLINICOS_FILA.includes(setor)) return '';
  const lista = FORMULARIOS_POR_SETOR[setor] || [];
  const botoes = lista.map(k => {
    const f = FORMULARIOS_PEC_REG[k];
    if (!f) return '';
    return `<button type="button" class="pec-form-btn" onclick="abrirFormularioAvulsoSetor('${setor}','${k}',false)">${f.shortLabel}</button>`;
  }).join('');
  const primeiro = lista[0] || 'receituario';
  const btnSisregBusca = `<button type="button" class="pec-form-btn sisreg" onclick="abrirModalSisregConsulta('${setor}')" title="Consultar códigos, procedimentos e fluxo hierárquico do SISREG (DS5)">🔎 Consultar SISREG</button>`;
  const btnSisregLeitor = setor === 'Médico'
    ? `<button type="button" class="pec-form-btn sisreg" onclick="abrirModalSisregLeitor('${setor}')" title="Ler foto/PDF de encaminhamento ou Ficha Ambulatorial com IA">📷 Ler Ficha SISREG</button>`
    : '';
  return `<div class="pec-forms-bar">
    <span class="pec-forms-title">🖨️ Formulários (PEC Offline):</span>
    ${botoes}
    <button type="button" class="pec-form-btn branco" onclick="abrirFormularioAvulsoSetor('${setor}','${primeiro}',true)" title="Abrir formulário totalmente em branco para impressão">📃 Em Branco</button>
    ${btnSisregBusca}
    ${btnSisregLeitor}
  </div>`;
}

function abrirSisregDoFormulario() {
  if (typeof abrirModalSisregConsulta === 'function') {
    const termo = _foEstadoAtual?.payload?.especialidade || '';
    abrirModalSisregConsulta(_foEstadoAtual?.setor || 'Médico', 'busca', termo);
  }
}

window.aplicarProcedimentoSisregNaFicha = function (proc, setor = 'Médico', dadosOcr = null) {
  const procTexto = proc?.name
    ? (proc.code ? `${proc.name} (${proc.code})` : proc.name)
    : (dadosOcr?.especialidade_ou_exame || '');
  const d = dadosOcr || {};
  const modal = document.getElementById('modal-formulario-oficial');
  const modalAberto = modal && modal.classList.contains('show') && _foEstadoAtual.tipo === 'ficha-ambulatorial';

  if (modalAberto) {
    const iframe = document.getElementById('fo-iframe');
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage({
        type: 'FORM_ATUALIZAR_PROCEDIMENTO',
        payload: {
          especialidade: procTexto,
          cid10: d.cid10 || '',
          hipotese_diagnostica: d.hipotese_diagnostica || '',
          justificativa: d.observacoes_revisada || d.observacoes_original || '',
          paciente_nome: d.paciente_nome || '',
          paciente_cns: d.paciente_cns || '',
          paciente_telefone: d.paciente_telefone || '',
          paciente_endereco: d.paciente_endereco || '',
          paciente_dn: d.paciente_dn || '',
          paciente_mae: d.paciente_mae || ''
        }
      }, window.location.origin);
      if (typeof showToast === 'function') showToast('✅ Procedimento aplicado na Ficha Ambulatorial!');
      return;
    }
  }

  const previaSintetica = {
    paciente_nome_ocr: d.paciente_nome || null,
    paciente_cns: d.paciente_cns || null,
    dados_extras: {
      especialidade: procTexto || null,
      cid10: d.cid10 || null,
      hipotese_diagnostica: d.hipotese_diagnostica || null,
      justificativa: d.observacoes_revisada || d.observacoes_original || null,
      paciente_telefone: d.paciente_telefone || null,
      paciente_endereco: d.paciente_endereco || null,
      paciente_data_nascimento: d.paciente_dn || null,
      paciente_mae: d.paciente_mae || null,
      paciente_sexo: d.paciente_sexo || null
    }
  };
  abrirFormularioOficial('ficha-ambulatorial', {
    modo: 'preencher',
    setor: SETORES_FORMULARIOS_PEC.includes(setor) ? setor : 'Médico',
    paciente: d.paciente_nome ? { nome: d.paciente_nome } : null,
    previa: previaSintetica
  });
};

function renderBotoesFormulariosLinha(p, setor) {
  if (!SETORES_CLINICOS_FILA.includes(setor) || !p?.id) return '';
  const lista = FORMULARIOS_LINHA_FILA[setor] || [];
  const botoes = lista.map(k => {
    const f = FORMULARIOS_PEC_REG[k];
    if (!f) return '';
    const extraCls = k === 'controle-especial' ? ' btn-fila-form-esp' : (k === 'ficha-ambulatorial' ? ' btn-fila-form-amb' : '');
    return `<button class="btn-fila-form${extraCls}" onclick="abrirFormularioPacienteFila(${p.id},'${setor}','${k}')" title="${f.titulo}">${f.icon}</button>`;
  }).join('');
  return `<span class="fila-forms-mini" onclick="event.stopPropagation()" title="Formulários (PEC Offline)">${botoes}</span>`;
}
