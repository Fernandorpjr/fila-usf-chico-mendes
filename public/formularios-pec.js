// Módulo Frontend — Formulários SUS/Recife (PEC Offline & Renovação de Receita)
const UNIDADE_PADRAO_USF = 'US 177 USF CHICO MENDES';
const CNES_PADRAO_USF = '0000965';
const SETORES_FORMULARIOS_PEC = ['Médico', 'Enfermagem', 'Odontologia', 'ACS', 'Recepção', 'Regulação', 'Acolhimento', 'Farmácia', 'Téc. Enfermagem'];
const SETORES_CLINICOS_FILA = ['Médico', 'Enfermagem', 'Odontologia'];

const FORMULARIOS_PEC_REG = {
  'receituario': {
    url: '/formularios/receituario.html?v=1.3',
    titulo: '📄 Receituário (2 vias espelhadas)',
    shortLabel: '📄 Receituário',
    icon: '📄'
  },
  'controle-especial': {
    url: '/formularios/receituario-controle-especial.html?v=1.3',
    titulo: '🔵 Receituário de Controle Especial (2 vias espelhadas)',
    shortLabel: '🔵 Controle Especial',
    icon: '🔵'
  },
  'exames-laboratoriais': {
    url: '/formularios/receituario-exames-laboratoriais.html?v=1.3',
    titulo: '🧪 Receituário para Exames Laboratoriais',
    shortLabel: '🧪 Exames Lab.',
    icon: '🧪'
  },
  'ficha-ambulatorial': {
    url: '/formularios/ficha-solicitacao-ambulatorial.html?v=1.3',
    titulo: '📋 Ficha de Solicitação Ambulatorial',
    shortLabel: '📋 Ficha Ambulatorial',
    icon: '📋'
  },
  'citopatologico': {
    url: '/formularios/requisicao-exame-citopatologico.html?v=1.3',
    titulo: '🔬 Requisição de Exame Citopatológico',
    shortLabel: '🔬 Citopatológico',
    icon: '🔬'
  },
  'registro-soap': {
    url: '/formularios/registro-tardio-soap.html?v=1.0',
    titulo: '📝 Ficha de Registro Tardio — SOAP',
    shortLabel: '📝 Registro SOAP',
    icon: '📝'
  },
  'declaracao-residencia': {
    url: '/formularios/declaracao-residencia.html?v=1.3',
    titulo: '🏠 Declaração de Residência (ACS)',
    shortLabel: '🏠 Decl. Residência',
    icon: '🏠'
  }
};

const FORMULARIOS_POR_SETOR = {
  'Médico': ['receituario', 'controle-especial', 'exames-laboratoriais', 'ficha-ambulatorial', 'registro-soap', 'citopatologico', 'declaracao-residencia'],
  'Enfermagem': ['receituario', 'citopatologico', 'exames-laboratoriais', 'ficha-ambulatorial', 'registro-soap', 'controle-especial', 'declaracao-residencia'],
  'Odontologia': ['receituario', 'controle-especial', 'ficha-ambulatorial', 'registro-soap', 'exames-laboratoriais', 'declaracao-residencia'],
  'ACS': ['declaracao-residencia', 'ficha-ambulatorial'],
  'Recepção': ['declaracao-residencia', 'ficha-ambulatorial', 'exames-laboratoriais'],
  'Regulação': ['ficha-ambulatorial', 'exames-laboratoriais', 'declaracao-residencia'],
  'Acolhimento': ['receituario', 'controle-especial', 'exames-laboratoriais', 'ficha-ambulatorial', 'citopatologico', 'declaracao-residencia'],
  'Farmácia': ['receituario', 'controle-especial', 'exames-laboratoriais', 'ficha-ambulatorial', 'declaracao-residencia'],
  'Téc. Enfermagem': ['receituario', 'exames-laboratoriais', 'ficha-ambulatorial', 'citopatologico', 'declaracao-residencia']
};

const FORMULARIOS_LINHA_FILA = {
  'Médico': ['receituario', 'controle-especial', 'exames-laboratoriais', 'ficha-ambulatorial', 'registro-soap', 'citopatologico'],
  'Enfermagem': ['receituario', 'citopatologico', 'exames-laboratoriais', 'ficha-ambulatorial', 'registro-soap'],
  'Odontologia': ['receituario', 'controle-especial', 'ficha-ambulatorial', 'registro-soap', 'exames-laboratoriais']
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

function obterHoraAgoraRecife() {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Recife',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date());
  } catch (_) {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

function limparNomeProfissional(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/^2[ªa]\s*Escuta\s*[-–:]\s*/i, '').trim();
  const parenMatch = s.match(/^2[ªa]\s*Escuta\s*\(([^)]+)\)$/i);
  if (parenMatch) {
    s = parenMatch[1].trim();
  }
  const norm = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const INVALIDOS = [
    '', '2a escuta', '1a escuta', 'acolhimento', 'se dirija a 2a escuta',
    'nao especificado', 'sem designacao', 'a definir', 'outro'
  ];
  if (INVALIDOS.includes(norm)) return '';
  return s;
}

function obterProfissionalSelecionadoSetor(setor, paciente) {
  if (paciente && typeof paciente === 'object') {
    const isEscuta2OuAcolh = paciente.etapa_fluxo === 'segunda_escuta' ||
      paciente.setor === 'Acolhimento' ||
      setor === 'Acolhimento';
    const candidatos = isEscuta2OuAcolh
      ? [paciente.profissional_destino, paciente.profissional, paciente.medico]
      : [paciente.profissional, paciente.medico, paciente.profissional_destino];
    for (const c of candidatos) {
      const limpo = limparNomeProfissional(c);
      if (limpo) return limpo;
    }
    if (typeof SECTOR_CONFIG !== 'undefined' && SECTOR_CONFIG[setor]) {
      const key = SECTOR_CONFIG[setor].key;
      const sel = document.getElementById(`profissional-${key}`);
      const selLimpo = sel ? limparNomeProfissional(sel.value) : '';
      if (selLimpo) return selLimpo;
      const filtLimpo = typeof sectorFilters !== 'undefined' ? limparNomeProfissional(sectorFilters[key]) : '';
      if (filtLimpo) return filtLimpo;
    }
    return '';
  }

  if (typeof SECTOR_CONFIG !== 'undefined' && SECTOR_CONFIG[setor]) {
    const key = SECTOR_CONFIG[setor].key;
    const sel = document.getElementById(`profissional-${key}`);
    const selLimpo = sel ? limparNomeProfissional(sel.value) : '';
    if (selLimpo) return selLimpo;
    const filtLimpo = typeof sectorFilters !== 'undefined' ? limparNomeProfissional(sectorFilters[key]) : '';
    if (filtLimpo) return filtLimpo;
    if (Array.isArray(SECTOR_CONFIG[setor].profissionais) && SECTOR_CONFIG[setor].profissionais[0]) {
      return limparNomeProfissional(SECTOR_CONFIG[setor].profissionais[0]);
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

function montarJustificativaClinica(_paciente, extraJustificativa) {
  // Comentários internos do Acolhimento (1ª e 2ª Escuta / queixa) NUNCA devem sair em formulários ou receituários.
  return extraJustificativa && String(extraJustificativa).trim()
    ? String(extraJustificativa).trim()
    : '';
}

function normTextFormFront(v) {
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function formatarCpfFront(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const digits = s.replace(/\D/g, '');
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  return '';
}

function formatarCnsFront(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const digits = s.replace(/\D/g, '');
  if (digits.length === 15) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7, 11)} ${digits.slice(11)}`;
  }
  return s;
}

function separarCnsCpfFront(cnsRaw, cpfRaw) {
  const cStr = String(cnsRaw || '').trim();
  const pStr = String(cpfRaw || '').trim();
  const cDig = cStr.replace(/\D/g, '');
  const pDig = pStr.replace(/\D/g, '');

  let cnsFinal = '';
  let cpfFinal = '';

  if (pDig.length === 11) cpfFinal = formatarCpfFront(pDig);
  else if (pDig.length === 15) cnsFinal = formatarCnsFront(pDig);

  if (cDig.length === 15) cnsFinal = formatarCnsFront(cDig);
  else if (cDig.length === 11) {
    if (!cpfFinal) cpfFinal = formatarCpfFront(cDig);
  } else if (cStr && !cnsFinal && cDig.length > 0 && cDig.length !== 11) {
    cnsFinal = cStr;
  }

  if (!cpfFinal && pStr && pDig.length > 0 && pDig.length !== 15) {
    cpfFinal = pStr;
  }
  return { paciente_cns: cnsFinal, paciente_cpf: cpfFinal };
}

function formatarCepFront(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const m = s.match(/(\d{5})[-.\s]?(\d{3})/);
  if (m) return `${m[1]}-${m[2]}`;
  const digits = s.replace(/\D/g, '');
  if (digits.length === 8) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return '';
}

function formatarTelFront(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  let digits = s.replace(/\D/g, '');
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    digits = digits.slice(2);
  }
  if (digits.length === 9 && digits.startsWith('9')) digits = `81${digits}`;
  else if (digits.length === 8) digits = `81${digits}`;
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return s;
}

function normalizarBairroUsfFront(bairroRaw, enderecoRaw = '') {
  const detectar = (txt) => {
    const clean = normTextFormFront(txt)
      .replace(/^bairro\s*[:\-]?\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean) return '';
    if (/(?:^|[\s,;\-\/])(?:cacote|cacot|casote|cassote|cac0te|cocote|cacoti)(?:$|[\s,;\-\/])/.test(clean)) {
      return 'Caçote';
    }
    if (/(?:^|[\s,;\-\/])(?:areias?|areia\s*do\s*recife|areis|ari[ae]s)(?:$|[\s,;\-\/])/.test(clean)) {
      return 'Areias';
    }
    if (/(?:^|[\s,;\-\/])(?:estancias?|estansia|estanc1a|extancia)(?:$|[\s,;\-\/])/.test(clean)) {
      return 'Estância';
    }
    return '';
  };
  const bStr = String(bairroRaw || '').trim();
  if (bStr) {
    const matched = detectar(bStr);
    if (matched) return matched;
    return bStr.replace(/^bairro\s*[:\-]?\s*/i, '').trim();
  }
  const eStr = String(enderecoRaw || '').trim();
  if (eStr) {
    return detectar(eStr);
  }
  return '';
}

function decomporEnderecoFront({
  endereco = '',
  numero = '',
  complemento = '',
  bairro = '',
  cep = '',
  municipio = '',
  uf = ''
} = {}) {
  let log = String(endereco || '').trim();
  let num = String(numero || '').trim();
  let comp = String(complemento || '').trim();
  let cepFmt = formatarCepFront(cep);
  const bairroNorm = normalizarBairroUsfFront(bairro, log);
  const mun = String(municipio || '').trim() || 'Recife';
  const ufClean = String(uf || '').trim().toUpperCase() || 'PE';

  if (log) {
    const cepMatch = log.match(/(?:CEP\s*[:\-]?\s*)?(\d{5})[-.\s]?(\d{3})\b/i);
    if (cepMatch) {
      if (!cepFmt) cepFmt = `${cepMatch[1]}-${cepMatch[2]}`;
      log = log.replace(cepMatch[0], ' ');
    }
    log = log.replace(/[\s,\-–]+Recife(?:\s*[\/\-]\s*PE)?\s*$/i, ' ');
    if (bairroNorm) {
      const rxB = new RegExp(`(?:,|\\s[-–]\\s|\\s+bairro\\s+)\\s*(?:${bairroNorm}|cac[o0]t[eé]?|areias?|est[aâ]ncias?)\\s*(?=$|,)`, 'gi');
      log = log.replace(rxB, ' ');
    }
    const compMatch = log.match(/(?:^|[,\s\-]+)((?:casa|cs|ap(?:to)?|apartamento|bl(?:oco)?|fundos|frente|t[ée]rreo|andar|quadra|qd|lote|lt)\b[^,]*?)(?=,|$)/i);
    if (compMatch) {
      if (!comp) comp = compMatch[1].replace(/\s+/g, ' ').trim();
      log = log.replace(compMatch[0], ' ');
    }
    if (!num) {
      const numMatch = log.match(/(?:,\s*|\s+)(?:n[º°o.]*\s*)?(\d+[A-Za-z]?|s\s*\/\s*n|sem\s+n[uú]mero)\s*(?=$|,|\s+-)/i);
      if (numMatch) {
        num = numMatch[1].replace(/\s+/g, '').toUpperCase();
        log = log.replace(numMatch[0], ' ');
      }
    } else {
      const numEsc = num.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      log = log.replace(new RegExp(`(?:,\\s*|\\s+)(?:n[º°o.]*\\s*)?${numEsc}\\s*(?=$|,|\\s+-)`, 'i'), ' ');
    }
    log = log
      .replace(/\bCEP\s*[:\-]?\s*$/i, '')
      .replace(/^[\s,\-–]+|[\s,\-–]+$/g, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s*,\s*,+/g, ',')
      .trim();
  }

  const partesCompletas = [];
  if (log) partesCompletas.push(log);
  if (num) partesCompletas.push(`nº ${num}`);
  if (comp) partesCompletas.push(comp);
  const tail = [bairroNorm, cepFmt ? `CEP ${cepFmt}` : ''].filter(Boolean).join(' - ');
  if (tail) partesCompletas.push(tail);

  return {
    logradouro: log,
    numero: num,
    complemento: comp,
    bairro: bairroNorm,
    cep: cepFmt,
    municipio: mun,
    uf: ufClean,
    endereco_completo: partesCompletas.join(', ')
  };
}

function detectarHiperdiaFront({ previa, ext, ocrAtivo, cid10, prescricao }) {
  let tem_hipertensao = Boolean(ext?.tem_hipertensao || ocrAtivo?.tem_hipertensao);
  let tem_diabetes = Boolean(ext?.tem_diabetes || ocrAtivo?.tem_diabetes);
  const perfilCod = normTextFormFront(ext?.perfil_clinico?.codigo || ext?.perfil_clinico || '');
  if (perfilCod === 'hipertenso') tem_hipertensao = true;
  if (perfilCod === 'diabetico') tem_diabetes = true;
  if (perfilCod === 'hipertenso_diabetico') {
    tem_hipertensao = true;
    tem_diabetes = true;
  }
  const cidNorm = normTextFormFront(cid10);
  if (/\bi1[0-5]\b/.test(cidNorm)) tem_hipertensao = true;
  if (/\be1[0-4]\b/.test(cidNorm)) tem_diabetes = true;

  const textoMeds = normTextFormFront([previa?.medicamentos, ocrAtivo?.medicamento, prescricao].filter(Boolean).join(' '));
  if (/\b(losartana|hidroclorotiazida|captopril|enalapril|anlodipino|nifedipino|atenolol|propranolol|metildopa|espironolactona|furosemida|carvedilol|clortalidona|valsartana|olmesartana|ramipril|metoprolol|indapamida)\b/.test(textoMeds)) {
    tem_hipertensao = true;
  }
  if (/\b(metformina|glibenclamida|gliclazida|glimepirida|dapagliflozina|empagliflozina|vildagliptina|sitagliptina|insulina)\b/.test(textoMeds)) {
    tem_diabetes = true;
  }
  return { tem_hipertensao, tem_diabetes };
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

  const rawCns = previa?.paciente_cns || ocrAtivo?.paciente_cns || paciente?.cns || '';
  const rawCpf = ocrAtivo?.paciente_cpf || ext.paciente_cpf || previa?.paciente_cpf || paciente?.cpf || '';
  const docs = separarCnsCpfFront(rawCns, rawCpf);
  const endDecomp = decomporEnderecoFront({
    endereco: ocrAtivo?.paciente_endereco || ext.paciente_endereco || paciente?.endereco || '',
    numero: ocrAtivo?.paciente_numero || ext.paciente_numero || paciente?.numero || '',
    complemento: ocrAtivo?.paciente_complemento || ext.paciente_complemento || paciente?.complemento || '',
    bairro: ocrAtivo?.paciente_bairro || ext.paciente_bairro || paciente?.bairro || '',
    cep: ocrAtivo?.paciente_cep || ext.paciente_cep || paciente?.cep || '',
    municipio: ocrAtivo?.paciente_municipio || ext.paciente_municipio || paciente?.municipio || '',
    uf: ocrAtivo?.paciente_uf || ext.paciente_uf || paciente?.uf || ''
  });
  const telFmt = formatarTelFront(ocrAtivo?.paciente_telefone || ext.paciente_telefone || paciente?.telefone || '');
  const hiperdia = detectarHiperdiaFront({ previa, ext, ocrAtivo, cid10, prescricao });

  return {
    modo: modo === 'branco' ? 'branco' : 'preencher',
    cnes: CNES_PADRAO_USF,
    unidade: UNIDADE_PADRAO_USF,
    distrito: 'V',
    profissional: obterProfissionalSelecionadoSetor(setor, paciente),
    acs_nome: acsNome || paciente?.acs_responsavel || '',
    data_dd: hoje.dd,
    data_mm: hoje.mm,
    data_aa: hoje.aa,
    data_br: hoje.data_br,
    hora_atendimento: obterHoraAgoraRecife(),
    paciente_nome: previa?.paciente_nome_ocr || paciente?.nome || '',
    paciente_idade: paciente?.idade !== undefined && paciente?.idade !== null ? String(paciente.idade) : '',
    paciente_gestante: /\bgestante\b/.test(normTextFormFront([paciente?.condicoes_especiais, paciente?.tipo_prioridade].filter(Boolean).join(' '))),
    paciente_cns: docs.paciente_cns,
    paciente_cpf: docs.paciente_cpf,
    paciente_rg: ocrAtivo?.paciente_rg || ext.paciente_rg || paciente?.rg || '',
    paciente_logradouro: endDecomp.logradouro,
    paciente_numero: endDecomp.numero,
    paciente_complemento: endDecomp.complemento,
    paciente_bairro: endDecomp.bairro,
    paciente_cep: endDecomp.cep,
    paciente_municipio: endDecomp.municipio,
    paciente_uf: endDecomp.uf,
    paciente_endereco: endDecomp.endereco_completo || endDecomp.logradouro || '',
    paciente_dn: ocrAtivo?.paciente_data_nascimento || ext.paciente_data_nascimento || '',
    paciente_sexo: ocrAtivo?.paciente_sexo || ext.paciente_sexo || '',
    paciente_telefone: telFmt,
    paciente_mae: ocrAtivo?.paciente_mae || ext.paciente_mae || '',
    prescricao,
    especialidade,
    tipo_solicitacao: ext.tipo_solicitacao || '',
    tipo_vaga: ocrAtivo?.tipo_vaga || ext.tipo_vaga || '',
    risco: ocrAtivo?.risco || ext.risco || '',
    codigo_solicitacao: ocrAtivo?.codigo_solicitacao || ext.codigo_solicitacao || '',
    tem_hipertensao: hiperdia.tem_hipertensao,
    tem_diabetes: hiperdia.tem_diabetes,
    exame_descricao: ext.exame_descricao || '',
    exame_solicitado: ext.exame_solicitado || '',
    exame_nome: ext.exame_nome || '',
    hipotese_diagnostica,
    cid10,
    justificativa: montarJustificativaClinica(paciente, justificativaExtra)
  };
}

function buscarPacienteNaMemoria(patientId, setor) {
  const pid = Number(patientId);
  const buscarEmAcolhimento = () => {
    if (typeof acolhimentoFluxo !== 'undefined' && acolhimentoFluxo) {
      for (const et of ['segunda_escuta', 'primeira_escuta', 'recepcao']) {
        const found = (acolhimentoFluxo[et] || []).find(p => Number(p.id) === pid);
        if (found) return found;
      }
    }
    return null;
  };

  if (setor === 'Acolhimento' || String(setor || '').startsWith('Acolhimento')) {
    const foundAcol = buscarEmAcolhimento();
    if (foundAcol) return foundAcol;
  }
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
  const foundAcol = buscarEmAcolhimento();
  if (foundAcol) return foundAcol;
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

  Object.keys(FORMULARIOS_PEC_REG).forEach(k => {
    const btn = document.getElementById(`fo-tab-${k}`);
    if (btn) {
      const visivel = k !== 'registro-soap' || SETORES_CLINICOS_FILA.includes(_foEstadoAtual.setor) || _foEstadoAtual.tipo === 'registro-soap';
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
    btnSisregFo.style.display = (_foEstadoAtual.tipo === 'ficha-ambulatorial' || _foEstadoAtual.tipo === 'exames-laboratoriais') ? 'inline-flex' : 'none';
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

  if (iframe.dataset.formUrl === targetUrl && currentPath === targetUrl.split('?')[0]) {
    enviarPayloadAoIframe();
  } else {
    iframe.dataset.formUrl = targetUrl;
    iframe.onload = () => enviarPayloadAoIframe();
    iframe.src = targetUrl;
  }
}

function abrirFormularioDaPrevia(tipoForm) {
  const ctx = window._previaModalDadosAtuais || {};
  const setor = ctx.setor || 'Médico';
  const pacMemoria = ctx.patientId ? buscarPacienteNaMemoria(ctx.patientId, setor) : null;
  const pacCtx = (ctx.paciente && typeof ctx.paciente === 'object') ? ctx.paciente : null;
  const previa = ctx.previa || pacMemoria?.previa_receita || pacCtx?.previa_receita || null;
  let pacienteFinal = (pacMemoria || pacCtx)
    ? { ...(pacCtx || {}), ...(pacMemoria || {}) }
    : (ctx.nomePaciente ? { id: ctx.patientId, nome: ctx.nomePaciente } : null);
  if (pacienteFinal && ctx.profissionalDirecionado && !limparNomeProfissional(pacienteFinal.profissional_destino) && !limparNomeProfissional(pacienteFinal.profissional)) {
    pacienteFinal.profissional_destino = ctx.profissionalDirecionado;
  }
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

function obterSetorKeyFormulario(setor) {
  if (typeof SECTOR_CONFIG !== 'undefined' && SECTOR_CONFIG[setor]?.key) {
    return SECTOR_CONFIG[setor].key;
  }
  return String(setor || 'clinico')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
}

function isPainelFormulariosRecolhido(setorKey) {
  try {
    return localStorage.getItem(`usf_pec_forms_collapsed_${setorKey}`) === '1';
  } catch (_) {
    return false;
  }
}

function togglePainelFormulariosSetor(btn, setorKey) {
  const grid = document.getElementById(`clinical-forms-grid-${setorKey}`);
  if (!grid) return;
  const recolher = !grid.classList.contains('collapsed');
  grid.classList.toggle('collapsed', recolher);
  if (btn) {
    btn.setAttribute('aria-expanded', recolher ? 'false' : 'true');
    btn.textContent = recolher ? '▸ Mostrar formulários' : '▾ Recolher formulários';
  }
  try {
    localStorage.setItem(`usf_pec_forms_collapsed_${setorKey}`, recolher ? '1' : '0');
  } catch (_) {}
}

function renderBarraFormulariosSetor(setor) {
  if (!SETORES_CLINICOS_FILA.includes(setor)) return '';
  const setorKey = obterSetorKeyFormulario(setor);
  const lista = FORMULARIOS_POR_SETOR[setor] || [];
  const botoes = lista.map(k => {
    const f = FORMULARIOS_PEC_REG[k];
    if (!f) return '';
    return `<button type="button" class="pec-form-btn" onclick="abrirFormularioAvulsoSetor('${setor}','${k}',false)" title="${f.titulo}">${f.shortLabel}</button>`;
  }).join('');
  const primeiro = lista[0] || 'receituario';
  const recolhido = isPainelFormulariosRecolhido(setorKey);

  const btnAnalisarReceita = ['Médico', 'Enfermagem', 'Odontologia'].includes(setor)
    ? `<button type="button" class="pec-form-btn receita" onclick="abrirModalAnalisarReceituario('${setor}')" title="Tirar foto ou enviar PDF de receituário para análise completa (Enfermeiro/Médico, Hiperdia, validade e comprimidos)">💊 Analisar Receituário</button>`
    : '';
  const btnSisregBusca = `<button type="button" class="pec-form-btn sisreg" onclick="abrirModalSisregConsulta('${setor}')" title="Consultar códigos, procedimentos e fluxo no SISREG (DS5)">🔎 Consultar SISREG</button>`;
  const btnSisregLeitor = setor === 'Médico'
    ? `<button type="button" class="pec-form-btn sisreg" onclick="abrirModalSisregLeitor('${setor}')" title="Abrir Prévia SISREG (Liberado para teste — Foto ou PDF)">📋 Prévia SISREG <span class="previa-teste-tag">Teste</span></button>`
    : '';
  const btnDevolucoes = `<button type="button" class="pec-form-btn devolucao" onclick="abrirModalDevolucoesProfissional('${setor}')" title="Ver e comentar devoluções do SISREG direcionadas para ${setor}">↩️ Devoluções SISREG <span class="sisreg-dev-count sisreg-dev-badge-setor" data-setor="${setor}" style="display:none;">0</span></button>`;

  return `<div class="pec-forms-bar clinical-tools-deck">
    <div class="clinical-tools-zone">
      <div class="clinical-zone-head">
        <span class="clinical-zone-label">🩺 Apoio Clínico &amp; Regulação (SISREG)</span>
      </div>
      <div class="clinical-quick-row">
        ${btnAnalisarReceita}
        ${btnSisregBusca}
        ${btnSisregLeitor}
        ${btnDevolucoes}
      </div>
    </div>
    <div class="clinical-tools-zone clinical-forms-zone">
      <div class="clinical-zone-head">
        <span class="clinical-zone-label">🖨️ Formulários Oficiais (PEC Offline)</span>
        <div class="clinical-zone-actions">
          <button type="button" class="pec-form-btn branco clinical-blank-btn" onclick="abrirFormularioAvulsoSetor('${setor}','${primeiro}',true)" title="Abrir formulário totalmente em branco para impressão">📃 Em Branco</button>
          <button type="button" class="clinical-forms-toggle-btn" aria-expanded="${recolhido ? 'false' : 'true'}" onclick="togglePainelFormulariosSetor(this,'${setorKey}')" title="Expandir ou recolher modelos de formulários">${recolhido ? '▸ Mostrar formulários' : '▾ Recolher formulários'}</button>
        </div>
      </div>
      <div id="clinical-forms-grid-${setorKey}" class="clinical-forms-grid${recolhido ? ' collapsed' : ''}">
        ${botoes}
      </div>
    </div>
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
  const isExame = String(proc?.type || '').toLowerCase() === 'exame';
  const normTxt = `${proc?.hierarchy || ''} ${proc?.name || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const isExameLab = isExame && /patologia clinica|exames de laboratorio|exame laboratorial/.test(normTxt);

  const modal = document.getElementById('modal-formulario-oficial');
  const modalAbertoQualquer = Boolean(modal && modal.classList.contains('show'));
  const modalAbertoFicha = modalAbertoQualquer && _foEstadoAtual.tipo === 'ficha-ambulatorial';
  const modalAbertoLab = modalAbertoQualquer && _foEstadoAtual.tipo === 'exames-laboratoriais';

  const docsProc = separarCnsCpfFront(d.paciente_cns, d.paciente_cpf);
  const endProc = decomporEnderecoFront({
    endereco: d.paciente_endereco || '',
    numero: d.paciente_numero || '',
    complemento: d.paciente_complemento || '',
    bairro: d.paciente_bairro || '',
    cep: d.paciente_cep || '',
    municipio: d.paciente_municipio || '',
    uf: d.paciente_uf || ''
  });
  const telProc = formatarTelFront(d.paciente_telefone || '');
  const hiperProc = detectarHiperdiaFront({
    previa: { medicamentos: d.medicamentos || '' },
    ext: { cid10: d.cid10 || '' },
    ocrAtivo: null,
    cid10: d.cid10 || '',
    prescricao: d.observacoes_revisada || ''
  });

  if (isExameLab && modalAbertoLab) {
    const iframe = document.getElementById('fo-iframe');
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage({
        type: 'FORM_ADICIONAR_EXAME',
        payload: {
          exame: procTexto,
          exame_nome: proc?.name || procTexto,
          exame_codigo: proc?.code || '',
          paciente_nome: d.paciente_nome || '',
          paciente_cns: docsProc.paciente_cns || docsProc.paciente_cpf || '',
          paciente_cpf: docsProc.paciente_cpf || '',
          paciente_telefone: telProc || ''
        }
      }, window.location.origin);
      if (typeof showToast === 'function') showToast('🧪 Exame adicionado ao Formulário de Exames Laboratoriais!');
      return;
    }
  }

  if (!isExameLab && modalAbertoFicha) {
    const iframe = document.getElementById('fo-iframe');
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage({
        type: 'FORM_ATUALIZAR_PROCEDIMENTO',
        payload: {
          tipo_solicitacao: isExame ? 'exame' : 'consulta',
          especialidade: isExame ? '' : procTexto,
          exame_descricao: isExame ? procTexto : '',
          profissional: obterProfissionalSelecionadoSetor(setor, _foEstadoAtual.paciente),
          cid10: d.cid10 || '',
          hipotese_diagnostica: d.hipotese_diagnostica || '',
          justificativa: d.observacoes_revisada || d.observacoes_original || '',
          paciente_nome: d.paciente_nome || '',
          paciente_cns: docsProc.paciente_cns || '',
          paciente_cpf: docsProc.paciente_cpf || '',
          paciente_telefone: telProc || '',
          paciente_logradouro: endProc.logradouro || '',
          paciente_numero: endProc.numero || '',
          paciente_complemento: endProc.complemento || '',
          paciente_bairro: endProc.bairro || '',
          paciente_cep: endProc.cep || '',
          paciente_municipio: endProc.municipio || 'Recife',
          paciente_uf: endProc.uf || 'PE',
          paciente_endereco: endProc.endereco_completo || endProc.logradouro || '',
          paciente_dn: d.paciente_dn || '',
          paciente_sexo: d.paciente_sexo || '',
          paciente_mae: d.paciente_mae || '',
          tipo_vaga: d.tipo_vaga || '',
          risco: d.risco || '',
          codigo_solicitacao: d.codigo_solicitacao || '',
          tem_hipertensao: hiperProc.tem_hipertensao,
          tem_diabetes: hiperProc.tem_diabetes
        }
      }, window.location.origin);
      if (typeof showToast === 'function') {
        showToast(isExame ? '✅ Exame inserido na seção de Exames da Ficha Ambulatorial!' : '✅ Consulta/Procedimento aplicado na Ficha Ambulatorial!');
      }
      return;
    }
  }

  const normNomeCmp = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const pacModalPrevia = (!modalAbertoQualquer && window._previaModalDadosAtuais?.paciente)
    ? window._previaModalDadosAtuais.paciente
    : null;
  const pacCompPrevia = pacModalPrevia && (!d.paciente_nome || normNomeCmp(pacModalPrevia.nome) === normNomeCmp(d.paciente_nome))
    ? pacModalPrevia
    : null;
  const basePac = modalAbertoQualquer ? _foEstadoAtual.paciente : pacCompPrevia;
  const basePrev = modalAbertoQualquer ? _foEstadoAtual.previa : null;
  const baseExt = (basePrev?.dados_extras && typeof basePrev.dados_extras === 'object') ? basePrev.dados_extras : {};
  const baseAnexos = modalAbertoQualquer && Array.isArray(_foEstadoAtual.anexos) ? _foEstadoAtual.anexos : [];
  const targetForm = isExameLab ? 'exames-laboratoriais' : 'ficha-ambulatorial';

  const previaSintetica = {
    ...(basePrev || {}),
    paciente_nome_ocr: d.paciente_nome || basePrev?.paciente_nome_ocr || null,
    paciente_cns: docsProc.paciente_cns || basePrev?.paciente_cns || null,
    dados_extras: {
      ...baseExt,
      tipo_solicitacao: isExame ? 'exame' : 'consulta',
      especialidade: isExame ? (baseExt.especialidade || null) : (procTexto || null),
      exame_descricao: (isExame && !isExameLab) ? procTexto : (baseExt.exame_descricao || null),
      exame_solicitado: isExameLab ? procTexto : (baseExt.exame_solicitado || null),
      exame_nome: isExameLab ? (proc?.name || procTexto) : (baseExt.exame_nome || null),
      cid10: d.cid10 || baseExt.cid10 || null,
      hipotese_diagnostica: d.hipotese_diagnostica || baseExt.hipotese_diagnostica || null,
      justificativa: d.observacoes_revisada || d.observacoes_original || baseExt.justificativa || null,
      paciente_cpf: docsProc.paciente_cpf || baseExt.paciente_cpf || null,
      paciente_rg: d.paciente_rg || baseExt.paciente_rg || null,
      paciente_telefone: telProc || baseExt.paciente_telefone || null,
      paciente_endereco: endProc.logradouro || baseExt.paciente_endereco || null,
      paciente_numero: endProc.numero || baseExt.paciente_numero || null,
      paciente_complemento: endProc.complemento || baseExt.paciente_complemento || null,
      paciente_bairro: endProc.bairro || baseExt.paciente_bairro || null,
      paciente_cep: endProc.cep || baseExt.paciente_cep || null,
      paciente_municipio: endProc.municipio || baseExt.paciente_municipio || null,
      paciente_uf: endProc.uf || baseExt.paciente_uf || null,
      paciente_data_nascimento: d.paciente_dn || baseExt.paciente_data_nascimento || null,
      paciente_mae: d.paciente_mae || baseExt.paciente_mae || null,
      paciente_sexo: d.paciente_sexo || baseExt.paciente_sexo || null,
      tipo_vaga: d.tipo_vaga || baseExt.tipo_vaga || null,
      risco: d.risco || baseExt.risco || null,
      codigo_solicitacao: d.codigo_solicitacao || baseExt.codigo_solicitacao || null,
      tem_hipertensao: hiperProc.tem_hipertensao || baseExt.tem_hipertensao || false,
      tem_diabetes: hiperProc.tem_diabetes || baseExt.tem_diabetes || false
    }
  };
  abrirFormularioOficial(targetForm, {
    modo: 'preencher',
    setor: SETORES_FORMULARIOS_PEC.includes(setor) ? setor : 'Médico',
    paciente: basePac || (d.paciente_nome ? { nome: d.paciente_nome } : null),
    previa: previaSintetica,
    anexos: baseAnexos
  });
};

let _filaFormsPopoverPid = null;
let _filaFormsPopoverBound = false;

function fecharMenuFormulariosPaciente() {
  const pop = document.getElementById('fila-forms-popover');
  if (pop) {
    pop.classList.remove('visible');
    pop.style.display = 'none';
  }
  _filaFormsPopoverPid = null;
}

function garantirListenersPopoverFormularios() {
  if (_filaFormsPopoverBound) return;
  _filaFormsPopoverBound = true;
  document.addEventListener('click', (e) => {
    const pop = document.getElementById('fila-forms-popover');
    if (!pop || !pop.classList.contains('visible')) return;
    if (!pop.contains(e.target) && !e.target.closest('.btn-fila-forms-trigger')) {
      fecharMenuFormulariosPaciente();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') fecharMenuFormulariosPaciente();
  });
  window.addEventListener('scroll', (e) => {
    const pop = document.getElementById('fila-forms-popover');
    if (!pop || !pop.classList.contains('visible')) return;
    if (e.target === document || e.target === window || (e.target && e.target.contains && e.target.contains(pop))) {
      fecharMenuFormulariosPaciente();
    }
  });
}

function abrirMenuFormulariosPaciente(event, patientId, setor) {
  if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
  garantirListenersPopoverFormularios();

  let pop = document.getElementById('fila-forms-popover');
  if (!pop) {
    pop = document.createElement('div');
    pop.id = 'fila-forms-popover';
    pop.className = 'fila-form-popover';
    pop.setAttribute('role', 'menu');
    document.body.appendChild(pop);
  }

  if (pop.classList.contains('visible') && Number(_filaFormsPopoverPid) === Number(patientId)) {
    fecharMenuFormulariosPaciente();
    return;
  }

  _filaFormsPopoverPid = Number(patientId);
  const pac = typeof buscarPacienteNaMemoria === 'function' ? buscarPacienteNaMemoria(patientId, setor) : null;
  const nomePac = pac?.nome ? String(pac.nome).trim() : 'Paciente';
  const esc = (v) => (typeof escapeText === 'function'
    ? escapeText(v)
    : String(v || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

  const lista = FORMULARIOS_LINHA_FILA[setor] || FORMULARIOS_LINHA_FILA['Médico'] || [];
  const itensHtml = lista.map(k => {
    const f = FORMULARIOS_PEC_REG[k];
    if (!f) return '';
    return `<button type="button" class="fila-form-popover-item" role="menuitem" onclick="fecharMenuFormulariosPaciente();abrirFormularioPacienteFila(${Number(patientId)},'${esc(setor)}','${esc(k)}')" title="${esc(f.titulo)}">
      <span class="ffp-label">${esc(f.shortLabel)}</span>
    </button>`;
  }).join('');

  pop.innerHTML = `
    <div class="fila-form-popover-head">📄 Formulários · ${esc(nomePac)}</div>
    <div class="fila-form-popover-list">${itensHtml}</div>
  `;
  pop.style.display = 'block';
  pop.classList.add('visible');

  const trigger = event?.currentTarget || event?.target?.closest('.btn-fila-forms-trigger');
  const rect = trigger ? trigger.getBoundingClientRect() : { left: event?.clientX || 120, bottom: event?.clientY || 120, right: (event?.clientX || 120) + 120, top: (event?.clientY || 120) - 30 };
  const pw = pop.offsetWidth || 240;
  const ph = pop.offsetHeight || 220;
  let left = rect.right - pw;
  if (left < 10) left = Math.max(10, rect.left);
  if (left + pw > window.innerWidth - 10) left = Math.max(10, window.innerWidth - pw - 10);
  let top = rect.bottom + 6;
  if (top + ph > window.innerHeight - 10) {
    top = Math.max(10, rect.top - ph - 6);
  }
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}

function renderBotoesFormulariosLinha(p, setor) {
  if (!SETORES_CLINICOS_FILA.includes(setor) || !p?.id) return '';
  return `<button type="button" class="btn-fila-forms-trigger" onclick="event.stopPropagation();abrirMenuFormulariosPaciente(event,${p.id},'${setor}')" title="Abrir formulários oficiais (PEC Offline) preenchidos para este paciente">📄 Formulários ▾</button>`;
}
