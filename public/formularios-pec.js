// Módulo Frontend — Formulários Oficiais SUS/Recife (PEC Offline & Renovação de Receita)
const SETORES_FORMULARIOS_PEC = ['Médico', 'Enfermagem', 'Odontologia'];

const FORMULARIOS_OFICIAIS_REG = {
  'receituario': {
    url: '/formularios/receituario.html',
    titulo: '📄 Receituário (2 vias espelhadas)'
  },
  'controle-especial': {
    url: '/formularios/receituario-controle-especial.html',
    titulo: '🔵 Receituário de Controle Especial (2 vias espelhadas)'
  },
  'ficha-ambulatorial': {
    url: '/formularios/ficha-solicitacao-ambulatorial.html',
    titulo: '📋 Ficha de Solicitação Ambulatorial'
  }
};

let _foEstadoAtual = {
  tipo: 'receituario',
  modo: 'preencher',
  setor: 'Médico',
  paciente: null,
  previa: null,
  imagemAntiga: null,
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

function montarPrescricaoTexto(previa) {
  if (!previa || typeof previa !== 'object') return '';
  const ext = previa.dados_extras && typeof previa.dados_extras === 'object' ? previa.dados_extras : {};
  if (ext.medicamentos_posologia && String(ext.medicamentos_posologia).trim()) {
    return String(ext.medicamentos_posologia).trim();
  }
  const meds = String(previa.medicamentos || '').trim();
  const obs = String(previa.observacoes || '').trim();
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

function montarJustificativaClinica(paciente) {
  if (!paciente) return '';
  const m1 = String(paciente.motivo_primeira_escuta || '').trim();
  const m2 = String(paciente.observacao_segunda_escuta || '').trim();
  const partes = [];
  if (m1) partes.push(`1ª Escuta: ${m1}`);
  if (m2) partes.push(`2ª Escuta: ${m2}`);
  return partes.join('\n');
}

function montarPayloadFormulario({ modo, setor, paciente, previa }) {
  const hoje = obterDataHojeRecife();
  const ext = previa?.dados_extras && typeof previa.dados_extras === 'object' ? previa.dados_extras : {};
  return {
    modo: modo === 'branco' ? 'branco' : 'preencher',
    unidade: '0177 USF Chico Mendes',
    profissional: obterProfissionalSelecionadoSetor(setor, paciente),
    data_dd: hoje.dd,
    data_mm: hoje.mm,
    data_aa: hoje.aa,
    data_br: hoje.data_br,
    paciente_nome: previa?.paciente_nome_ocr || paciente?.nome || '',
    paciente_cns: previa?.paciente_cns || '',
    paciente_endereco: ext.paciente_endereco || '',
    paciente_dn: ext.paciente_data_nascimento || '',
    paciente_sexo: ext.paciente_sexo || '',
    paciente_telefone: ext.paciente_telefone || '',
    paciente_mae: ext.paciente_mae || '',
    prescricao: montarPrescricaoTexto(previa),
    justificativa: montarJustificativaClinica(paciente)
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

function atualizarUITopoModalFormulario() {
  const info = FORMULARIOS_OFICIAIS_REG[_foEstadoAtual.tipo] || FORMULARIOS_OFICIAIS_REG.receituario;
  const tit = document.getElementById('fo-titulo');
  const sub = document.getElementById('fo-subtitulo');
  if (tit) tit.textContent = info.titulo;
  if (sub) {
    const pacNome = _foEstadoAtual.payload?.paciente_nome || _foEstadoAtual.paciente?.nome;
    const modoTxt = _foEstadoAtual.modo === 'branco' ? 'Em Branco (Manual)' : (pacNome ? `Paciente: ${pacNome}` : `Avulso (${_foEstadoAtual.setor})`);
    sub.textContent = `${_foEstadoAtual.setor} · ${modoTxt}`;
  }

  Object.keys(FORMULARIOS_OFICIAIS_REG).forEach(k => {
    const btn = document.getElementById(`fo-tab-${k}`);
    if (btn) btn.classList.toggle('active', k === _foEstadoAtual.tipo);
  });

  const btnPreencher = document.getElementById('fo-btn-preencher');
  if (btnPreencher) {
    const temContexto = Boolean(_foEstadoAtual.paciente || _foEstadoAtual.previa || _foEstadoAtual.modo === 'preencher');
    btnPreencher.style.display = temContexto ? 'inline-flex' : 'none';
  }

  const btnFoto = document.getElementById('fo-btn-ver-foto');
  const paneFoto = document.getElementById('fo-ref-pane');
  const imgFoto = document.getElementById('fo-ref-img');
  if (btnFoto && paneFoto && imgFoto) {
    if (_foEstadoAtual.imagemAntiga) {
      btnFoto.style.display = 'inline-flex';
      imgFoto.src = _foEstadoAtual.imagemAntiga;
    } else {
      btnFoto.style.display = 'none';
      paneFoto.classList.remove('show');
      imgFoto.src = '';
    }
  }
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
  const tipo = FORMULARIOS_OFICIAIS_REG[tipoForm] ? tipoForm : 'receituario';
  const setor = contexto.setor || 'Médico';
  if (!SETORES_FORMULARIOS_PEC.includes(setor)) {
    if (typeof showToast === 'function') showToast('Formulários disponíveis apenas para Médico, Enfermagem e Odontologia.', true);
    return;
  }

  const modo = contexto.modo === 'branco' ? 'branco' : 'preencher';
  const paciente = contexto.paciente || null;
  const previa = contexto.previa || paciente?.previa_receita || null;
  const imagemAntiga = contexto.imagemAntiga || previa?.imagem_base64 || null;

  _foEstadoAtual = {
    tipo,
    modo,
    setor,
    paciente,
    previa,
    imagemAntiga,
    payload: montarPayloadFormulario({ modo, setor, paciente, previa })
  };

  resetRefFotoForm();
  atualizarUITopoModalFormulario();
  inicializarPanZoomRefFormulario();

  const paneFoto = document.getElementById('fo-ref-pane');
  if (paneFoto) paneFoto.classList.remove('show');

  const iframe = document.getElementById('fo-iframe');
  const modal = document.getElementById('modal-formulario-oficial');
  if (!iframe || !modal) return;

  const targetUrl = FORMULARIOS_OFICIAIS_REG[tipo].url;
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
  abrirFormularioOficial(tipoForm, {
    modo: 'preencher',
    setor,
    paciente: pacienteFinal,
    previa,
    imagemAntiga: previa?.imagem_base64 || null
  });
}

async function abrirFormularioPacienteFila(patientId, setor, tipoForm) {
  let paciente = buscarPacienteNaMemoria(patientId, setor);
  let previa = paciente?.previa_receita || null;
  if (previa && !previa.imagem_base64) {
    try {
      const r = await fetch(`${API_URL}/patients/${patientId}/previa-receita`, { cache: 'no-store' });
      if (r.ok) previa = await r.json();
    } catch (_) {}
  }
  abrirFormularioOficial(tipoForm, {
    modo: 'preencher',
    setor,
    paciente,
    previa,
    imagemAntiga: previa?.imagem_base64 || null
  });
}

function abrirFormularioAvulsoSetor(setor, tipoForm, emBranco = false) {
  abrirFormularioOficial(tipoForm, {
    modo: emBranco ? 'branco' : 'preencher',
    setor,
    paciente: null,
    previa: null,
    imagemAntiga: null
  });
}

function trocarTipoFormularioModal(tipoForm) {
  if (!FORMULARIOS_OFICIAIS_REG[tipoForm]) return;
  abrirFormularioOficial(tipoForm, {
    modo: _foEstadoAtual.modo,
    setor: _foEstadoAtual.setor,
    paciente: _foEstadoAtual.paciente,
    previa: _foEstadoAtual.previa,
    imagemAntiga: _foEstadoAtual.imagemAntiga
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
  _foEstadoAtual.payload = montarPayloadFormulario({
    modo: 'preencher',
    setor: _foEstadoAtual.setor,
    paciente: _foEstadoAtual.paciente,
    previa: _foEstadoAtual.previa
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
  const info = FORMULARIOS_OFICIAIS_REG[_foEstadoAtual.tipo] || FORMULARIOS_OFICIAIS_REG.receituario;
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

function renderBotoesFormulariosLinha(p, setor) {
  if (!SETORES_FORMULARIOS_PEC.includes(setor) || !p?.id) return '';
  return `<span class="fila-forms-mini" onclick="event.stopPropagation()" title="Formulários Oficiais (PEC Offline)"><button class="btn-fila-form" onclick="abrirFormularioPacienteFila(${p.id},'${setor}','receituario')" title="Receituário (2 vias)">📄</button><button class="btn-fila-form btn-fila-form-esp" onclick="abrirFormularioPacienteFila(${p.id},'${setor}','controle-especial')" title="Receituário de Controle Especial (2 vias)">🔵</button><button class="btn-fila-form btn-fila-form-amb" onclick="abrirFormularioPacienteFila(${p.id},'${setor}','ficha-ambulatorial')" title="Ficha de Solicitação Ambulatorial">📋</button></span>`;
}
