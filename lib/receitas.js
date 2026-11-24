// Módulo de Prévia de Receitas (Hiperdia & Renovação de Receita) — Integrado à Fila USF Chico Mendes
const { checkRateLimit, getClientIp } = require('./seguranca');
const { executarOcrGeminiJson } = require('./ocr-ai');

const MEDICAMENTOS_PADRAO = {
  losartana: { nome: 'Losartana', pode_enfermeiro: true, categoria: 'anti-hipertensivo' },
  hidroclorotiazida: { nome: 'Hidroclorotiazida', pode_enfermeiro: true, categoria: 'anti-hipertensivo' },
  captopril: { nome: 'Captopril', pode_enfermeiro: true, categoria: 'anti-hipertensivo' },
  enalapril: { nome: 'Enalapril', pode_enfermeiro: true, categoria: 'anti-hipertensivo' },
  anlodipino: { nome: 'Anlodipino', pode_enfermeiro: true, categoria: 'anti-hipertensivo' },
  nifedipino: { nome: 'Nifedipino', pode_enfermeiro: true, categoria: 'anti-hipertensivo' },
  atenolol: { nome: 'Atenolol', pode_enfermeiro: true, categoria: 'anti-hipertensivo' },
  propranolol: { nome: 'Propranolol', pode_enfermeiro: true, categoria: 'anti-hipertensivo' },
  metildopa: { nome: 'Metildopa', pode_enfermeiro: true, categoria: 'anti-hipertensivo' },
  espironolactona: { nome: 'Espironolactona', pode_enfermeiro: true, categoria: 'anti-hipertensivo' },
  furosemida: { nome: 'Furosemida', pode_enfermeiro: true, categoria: 'anti-hipertensivo/diurético' },
  verapamil: { nome: 'Verapamil', pode_enfermeiro: true, categoria: 'anti-hipertensivo' },
  carvedilol: { nome: 'Carvedilol', pode_enfermeiro: true, categoria: 'anti-hipertensivo' },
  metformina: { nome: 'Metformina', pode_enfermeiro: true, categoria: 'hipoglicemiante' },
  glibenclamida: { nome: 'Glibenclamida', pode_enfermeiro: true, categoria: 'hipoglicemiante' },
  gliclazida: { nome: 'Gliclazida', pode_enfermeiro: true, categoria: 'hipoglicemiante' },
  'insulina nph': { nome: 'Insulina NPH', pode_enfermeiro: true, categoria: 'hipoglicemiante' },
  'insulina regular': { nome: 'Insulina Regular', pode_enfermeiro: true, categoria: 'hipoglicemiante' },
  albendazol: { nome: 'Albendazol', pode_enfermeiro: true, categoria: 'antiparasitário' },
  mebendazol: { nome: 'Mebendazol', pode_enfermeiro: true, categoria: 'antiparasitário' },
  metronidazol: { nome: 'Metronidazol', pode_enfermeiro: true, categoria: 'antiparasitário' },
  permetrina: { nome: 'Permetrina', pode_enfermeiro: true, categoria: 'escabiose' },
  ivermectina: { nome: 'Ivermectina', pode_enfermeiro: true, categoria: 'escabiose' },
  'acido folico': { nome: 'Ácido Fólico', pode_enfermeiro: true, categoria: 'pré-natal' },
  'sulfato ferroso': { nome: 'Sulfato Ferroso', pode_enfermeiro: true, categoria: 'pré-natal' },
  'carbonato de calcio': { nome: 'Carbonato de Cálcio', pode_enfermeiro: true, categoria: 'pré-natal' },
  nistatina: { nome: 'Nistatina', pode_enfermeiro: true, categoria: 'antifúngico' },
  miconazol: { nome: 'Miconazol', pode_enfermeiro: true, categoria: 'antifúngico' },
  fluconazol: { nome: 'Fluconazol', pode_enfermeiro: true, categoria: 'antifúngico' },
  cetoconazol: { nome: 'Cetoconazol', pode_enfermeiro: true, categoria: 'antifúngico' },
  levonorgestrel: { nome: 'Levonorgestrel', pode_enfermeiro: true, categoria: 'contraceptivo' },
  noretisterona: { nome: 'Noretisterona', pode_enfermeiro: true, categoria: 'contraceptivo' },
  paracetamol: { nome: 'Paracetamol', pode_enfermeiro: true, categoria: 'analgésico' },
  dipirona: { nome: 'Dipirona', pode_enfermeiro: true, categoria: 'analgésico' },
  ibuprofeno: { nome: 'Ibuprofeno', pode_enfermeiro: true, categoria: 'analgésico' },
  'benzilpenicilina benzatina': { nome: 'Benzilpenicilina Benzatina', pode_enfermeiro: true, categoria: 'IST' },
  dolutegravir: { nome: 'Dolutegravir', pode_enfermeiro: true, categoria: 'HIV' },
  sinvastatina: { nome: 'Sinvastatina', pode_enfermeiro: false, categoria: 'cardiovascular' },
  atorvastatina: { nome: 'Atorvastatina', pode_enfermeiro: false, categoria: 'cardiovascular' },
  aas: { nome: 'AAS (Ácido Acetilsalicílico)', pode_enfermeiro: false, categoria: 'cardiovascular' },
  'acido acetilsalicilico': { nome: 'AAS (Ácido Acetilsalicílico)', pode_enfermeiro: false, categoria: 'cardiovascular' },
  levotiroxina: { nome: 'Levotiroxina', pode_enfermeiro: false, categoria: 'endócrino' },
  omeprazol: { nome: 'Omeprazol', pode_enfermeiro: false, categoria: 'gastro' },
  varfarina: { nome: 'Varfarina', pode_enfermeiro: false, categoria: 'anticoagulante' },
  alopurinol: { nome: 'Alopurinol', pode_enfermeiro: false, categoria: 'outros' },
  fluoxetina: { nome: 'Fluoxetina', pode_enfermeiro: false, categoria: 'saúde mental' },
  sertralina: { nome: 'Sertralina', pode_enfermeiro: false, categoria: 'saúde mental' },
  amitriptilina: { nome: 'Amitriptilina', pode_enfermeiro: false, categoria: 'saúde mental' },
  salbutamol: { nome: 'Salbutamol', pode_enfermeiro: false, categoria: 'respiratório' },
  beclometasona: { nome: 'Beclometasona', pode_enfermeiro: false, categoria: 'respiratório' },
  clonazepam: { nome: 'Clonazepam', pode_enfermeiro: false, categoria: 'benzodiazepínico' },
  diazepam: { nome: 'Diazepam', pode_enfermeiro: false, categoria: 'benzodiazepínico' },
  fenobarbital: { nome: 'Fenobarbital', pode_enfermeiro: false, categoria: 'anticonvulsivante' },
  carbamazepina: { nome: 'Carbamazepina', pode_enfermeiro: false, categoria: 'anticonvulsivante' },
  metilfenidato: { nome: 'Metilfenidato', pode_enfermeiro: false, categoria: 'psicoestimulante' },
  haloperidol: { nome: 'Haloperidol', pode_enfermeiro: false, categoria: 'antipsicótico' },
  risperidona: { nome: 'Risperidona', pode_enfermeiro: false, categoria: 'antipsicótico' },
  tramadol: { nome: 'Tramadol', pode_enfermeiro: false, categoria: 'analgésico opioide' },
  codeina: { nome: 'Codeína', pode_enfermeiro: false, categoria: 'analgésico opioide' }
};

function normText(v) {
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function parseDataBR(dataStr) {
  const m = String(dataStr || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const d = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const y = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  return { d, mo, y };
}

function calcularDataVencimento(dataEmissao, meses) {
  const p = parseDataBR(dataEmissao);
  if (!p) return null;
  const dt = new Date(Date.UTC(p.y, p.mo - 1, p.d));
  dt.setUTCMonth(dt.getUTCMonth() + (Number(meses) || 6));
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = dt.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function calcularDiasRestantes(dataVencimento, refDate = new Date()) {
  const p = parseDataBR(dataVencimento);
  if (!p) return null;
  const hojeStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Recife', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(refDate);
  const [hy, hm, hd] = hojeStr.split('-').map(Number);
  const hojeUtc = Date.UTC(hy, hm - 1, hd);
  const vencUtc = Date.UTC(p.y, p.mo - 1, p.d);
  return Math.ceil((vencUtc - hojeUtc) / (1000 * 60 * 60 * 24));
}

function classificarUrgencia(diasRestantes) {
  if (diasRestantes === null || diasRestantes === undefined) return 'normal';
  if (diasRestantes < 0) return 'vencida';
  if (diasRestantes <= 7) return 'urgente';
  return 'normal';
}

function classificarReceita(tipo_receita, medicamento, data_emissao, refDate = new Date()) {
  const tipoNorm = normText(tipo_receita);
  let tipo = 'branca';
  if (tipoNorm.includes('azul')) tipo = 'azul';
  else if (tipoNorm.includes('odonto')) tipo = 'odonto';
  else if (tipoNorm === 'incerto') tipo = 'incerto';

  let fila_destino = 'Médico';
  let validade_meses = 6;
  let medicamento_desconhecido = false;
  const desconhecidos = [];
  const restritos_medico = [];

  if (tipo === 'azul') {
    fila_destino = 'Médico';
    validade_meses = 2;
  } else if (tipo === 'odonto') {
    fila_destino = 'Odontologia';
    validade_meses = 6;
  } else if (tipo === 'branca') {
    validade_meses = 6;
    const meds = String(medicamento || '')
      .split(/[,;\n]+/)
      .map(s => s.trim())
      .filter(Boolean);

    if (meds.length === 0) {
      fila_destino = 'Médico';
      medicamento_desconhecido = true;
    } else {
      let todosEnfermeiro = true;
      for (const m of meds) {
        const mNorm = normText(m);
        let match = null;
        for (const [key, info] of Object.entries(MEDICAMENTOS_PADRAO)) {
          if (mNorm.includes(key) || key.includes(mNorm)) {
            match = info;
            break;
          }
        }
        if (!match) {
          medicamento_desconhecido = true;
          desconhecidos.push(m);
          todosEnfermeiro = false;
        } else if (!match.pode_enfermeiro) {
          restritos_medico.push(match.nome || m);
          todosEnfermeiro = false;
        }
      }
      fila_destino = todosEnfermeiro ? 'Enfermagem' : 'Médico';
    }
  }

  const data_vencimento = calcularDataVencimento(data_emissao, validade_meses);
  const dias_restantes = data_vencimento ? calcularDiasRestantes(data_vencimento, refDate) : null;
  const urgencia = classificarUrgencia(dias_restantes);
  const pode_enfermeiro = fila_destino === 'Enfermagem';

  let motivo_profissional = '';
  if (tipo === 'azul') {
    motivo_profissional = 'Receita Azul (Controle Especial) — exclusiva do Médico';
  } else if (tipo === 'odonto') {
    motivo_profissional = 'Receita Odontológica — atendimento com Dentista (Odontologia)';
  } else if (pode_enfermeiro) {
    motivo_profissional = 'Todos os medicamentos estão liberados para renovação pelo Enfermeiro';
  } else if (restritos_medico.length > 0) {
    motivo_profissional = `Restrito ao Médico (contém: ${[...new Set(restritos_medico)].join(', ')})`;
  } else if (desconhecidos.length > 0) {
    motivo_profissional = `Exige avaliação do Médico (medicamento fora da lista de Enfermagem: ${desconhecidos.join(', ')})`;
  } else {
    motivo_profissional = 'Medicamento não identificado — encaminhar ao Médico';
  }

  return {
    tipo_receita: tipo,
    fila_destino,
    pode_enfermeiro,
    restritos_medico,
    motivo_profissional,
    validade_meses,
    data_vencimento,
    dias_restantes,
    urgencia,
    medicamento_desconhecido,
    desconhecidos
  };
}

const MAX_ANEXOS_PREVIA = 6;
const MAX_CHAR_POR_ANEXO = 2_900_000;
const MAX_CHAR_TOTAL_ANEXOS = 3_400_000;

function normalizarCategoriaAnexo(v) {
  const s = normText(v);
  if (s === 'receita_azul' || s === 'azul' || s.includes('azul') || s.includes('controlad')) return 'receita_azul';
  if (s === 'odonto' || s.includes('odonto')) return 'odonto';
  if (
    s === 'encaminhamento' ||
    s === 'sisreg' ||
    s.includes('encaminha') ||
    s.includes('ambulatorial') ||
    s.includes('referencia') ||
    s.includes('sisreg')
  ) {
    return 'encaminhamento';
  }
  if (s === 'exame' || s.includes('exame') || s.includes('laudo') || s.includes('solicitacao')) return 'exame';
  return 'receita_branca';
}

function limparCampoExtra(v, maxLen = 200) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s || /^null$/i.test(s) || /^n[ãa]o informado$/i.test(s)) return null;
  return s.slice(0, maxLen);
}

function normalizarDadosExtras(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw.dados_extras && typeof raw.dados_extras === 'object' ? raw.dados_extras : raw;
  const out = {
    medicamentos_posologia: limparCampoExtra(src.medicamentos_posologia, 2500),
    paciente_endereco: limparCampoExtra(src.paciente_endereco, 300),
    paciente_data_nascimento: limparCampoExtra(src.paciente_data_nascimento || src.data_nascimento, 30),
    paciente_sexo: (() => {
      const s = limparCampoExtra(src.paciente_sexo || src.sexo, 20);
      if (!s) return null;
      const u = normText(s).toUpperCase();
      if (u.startsWith('M')) return 'M';
      if (u.startsWith('F')) return 'F';
      return null;
    })(),
    paciente_telefone: limparCampoExtra(src.paciente_telefone || src.telefone, 40),
    paciente_mae: limparCampoExtra(src.paciente_mae || src.nome_mae, 180),
    especialidade: limparCampoExtra(src.especialidade, 120),
    hipotese_diagnostica: limparCampoExtra(src.hipotese_diagnostica, 240),
    cid10: limparCampoExtra(src.cid10, 20),
    justificativa: limparCampoExtra(src.justificativa, 800)
  };
  const extrasReg = {
    paciente_municipio: limparCampoExtra(src.paciente_municipio || src.municipio, 100),
    paciente_uf: limparCampoExtra(src.paciente_uf || src.uf, 10),
    paciente_cep: limparCampoExtra(src.paciente_cep || src.cep, 20),
    paciente_bairro: limparCampoExtra(src.paciente_bairro || src.bairro, 120),
    tipo_vaga: limparCampoExtra(src.tipo_vaga, 30),
    risco: limparCampoExtra(src.risco, 20),
    codigo_solicitacao: limparCampoExtra(src.codigo_solicitacao, 60),
    observacoes_revisada: limparCampoExtra(src.observacoes_revisada, 2500),
    destino_ia: limparCampoExtra(src.destino_ia, 20)
  };
  for (const [k, v] of Object.entries(extrasReg)) {
    if (v) out[k] = v;
  }
  if (Array.isArray(src.alertas_digitacao) && src.alertas_digitacao.length > 0) {
    const arr = src.alertas_digitacao.map(x => limparCampoExtra(x, 220)).filter(Boolean);
    if (arr.length > 0) out.alertas_digitacao = arr;
  }
  return Object.values(out).some(Boolean) ? out : null;
}

function limparOcrAnexo(ocr) {
  if (!ocr || typeof ocr !== 'object') return null;
  const out = {
    tipo_receita: limparCampoExtra(ocr.tipo_receita, 30),
    tipo_documento: ocr.tipo_documento ? normalizarCategoriaAnexo(ocr.tipo_documento) : null,
    medicamento: limparCampoExtra(ocr.medicamento, 1200),
    medicamentos_posologia: limparCampoExtra(ocr.medicamentos_posologia, 2000),
    data_emissao: limparCampoExtra(ocr.data_emissao, 20),
    observacoes: limparCampoExtra(ocr.observacoes, 600),
    especialidade: limparCampoExtra(ocr.especialidade, 120),
    hipotese_diagnostica: limparCampoExtra(ocr.hipotese_diagnostica, 240),
    cid10: limparCampoExtra(ocr.cid10, 20),
    justificativa: limparCampoExtra(ocr.justificativa, 800)
  };
  const extrasReg = {
    paciente_municipio: limparCampoExtra(ocr.paciente_municipio, 100),
    paciente_uf: limparCampoExtra(ocr.paciente_uf, 10),
    paciente_cep: limparCampoExtra(ocr.paciente_cep, 20),
    paciente_bairro: limparCampoExtra(ocr.paciente_bairro, 120),
    tipo_vaga: limparCampoExtra(ocr.tipo_vaga, 30),
    risco: limparCampoExtra(ocr.risco, 20),
    codigo_solicitacao: limparCampoExtra(ocr.codigo_solicitacao, 60),
    observacoes_revisada: limparCampoExtra(ocr.observacoes_revisada, 2500),
    destino_ia: limparCampoExtra(ocr.destino_ia, 20)
  };
  for (const [k, v] of Object.entries(extrasReg)) {
    if (v) out[k] = v;
  }
  if (Array.isArray(ocr.alertas_digitacao) && ocr.alertas_digitacao.length > 0) {
    const arr = ocr.alertas_digitacao.map(x => limparCampoExtra(x, 220)).filter(Boolean);
    if (arr.length > 0) out.alertas_digitacao = arr;
  }
  return Object.values(out).some(Boolean) ? out : null;
}

function normalizarAnexosPrevia(rawAnexos, fallbackImg, fallbackTipo) {
  const candidatos = Array.isArray(rawAnexos) ? rawAnexos : [];
  const out = [];
  let totalChars = 0;

  for (let i = 0; i < candidatos.length && out.length < MAX_ANEXOS_PREVIA; i++) {
    const item = candidatos[i];
    if (!item || typeof item !== 'object') continue;
    const imgStr = typeof item.imagem_base64 === 'string' ? item.imagem_base64.trim() : '';
    if (imgStr.length < 20 || imgStr.length > MAX_CHAR_POR_ANEXO) continue;
    if (totalChars + imgStr.length > MAX_CHAR_TOTAL_ANEXOS) continue;
    totalChars += imgStr.length;
    const obj = {
      id: limparCampoExtra(item.id, 40) || `anx_${out.length + 1}`,
      categoria: normalizarCategoriaAnexo(item.categoria || item.tipo_documento || item.tipo_receita || fallbackTipo),
      rotulo: limparCampoExtra(item.rotulo, 60),
      imagem_base64: imgStr,
      ocr: limparOcrAnexo(item.ocr)
    };
    const isPdf = item.mime_type === 'application/pdf' || imgStr.startsWith('data:application/pdf');
    if (isPdf) obj.mime_type = 'application/pdf';
    else if (item.mime_type) obj.mime_type = limparCampoExtra(item.mime_type, 60);
    const nomeArq = limparCampoExtra(item.nome_arquivo, 120);
    if (nomeArq) obj.nome_arquivo = nomeArq;
    out.push(obj);
  }

  if (out.length === 0 && typeof fallbackImg === 'string') {
    const fb = fallbackImg.trim();
    if (fb.length >= 20 && fb.length <= MAX_CHAR_TOTAL_ANEXOS) {
      const obj = {
        id: 'anx_1',
        categoria: normalizarCategoriaAnexo(fallbackTipo),
        rotulo: null,
        imagem_base64: fb,
        ocr: null
      };
      if (fb.startsWith('data:application/pdf')) obj.mime_type = 'application/pdf';
      out.push(obj);
    }
  }

  return out;
}

function resumirAnexosSemImagem(anexos) {
  if (!Array.isArray(anexos)) return [];
  return anexos
    .filter(a => a && typeof a === 'object')
    .slice(0, MAX_ANEXOS_PREVIA)
    .map((a, idx) => {
      const res = {
        id: limparCampoExtra(a.id, 40) || `anx_${idx + 1}`,
        categoria: normalizarCategoriaAnexo(a.categoria),
        rotulo: limparCampoExtra(a.rotulo, 60)
      };
      const isPdf = a.mime_type === 'application/pdf' ||
        (typeof a.imagem_base64 === 'string' && a.imagem_base64.startsWith('data:application/pdf'));
      if (isPdf) res.mime_type = 'application/pdf';
      else if (a.mime_type) res.mime_type = limparCampoExtra(a.mime_type, 60);
      const nomeArq = limparCampoExtra(a.nome_arquivo, 120);
      if (nomeArq) res.nome_arquivo = nomeArq;
      return res;
    });
}

function classificarDocumentoPrevia(ocr, refDate = new Date()) {
  const o = ocr && typeof ocr === 'object' ? ocr : {};
  const dest = normText(o.destino_ia);
  const docNorm = normText(o.tipo_documento || o.tipo_receita);
  const temMed = Boolean(limparCampoExtra(o.medicamento, 1200));
  const temCodSisreg = Boolean(limparCampoExtra(o.codigo_solicitacao, 60));
  const temEsp = Boolean(limparCampoExtra(o.especialidade, 120));

  const ehSisreg = dest === 'sisreg' ||
    docNorm === 'sisreg' ||
    docNorm === 'encaminhamento' ||
    docNorm.includes('ambulatorial') ||
    docNorm.includes('sisreg') ||
    temCodSisreg ||
    (!temMed && temEsp && !docNorm.includes('azul') && !docNorm.includes('odonto'));

  if (ehSisreg) {
    return {
      categoria_destino: 'sisreg',
      tipo_receita: 'sisreg',
      fila_destino: 'Regulação',
      validade_meses: null,
      data_vencimento: null,
      dias_restantes: null,
      urgencia: 'normal',
      medicamento_desconhecido: false,
      desconhecidos: []
    };
  }

  const clf = classificarReceita(
    o.tipo_receita || o.tipo_documento || 'branca',
    o.medicamento || '',
    o.data_emissao || '',
    refDate
  );
  return {
    ...clf,
    categoria_destino: 'receita'
  };
}

function formatarPrescricaoParaFormulario(previa) {
  if (!previa || typeof previa !== 'object') return '';
  const extras = normalizarDadosExtras(previa);
  if (extras && extras.medicamentos_posologia) {
    return extras.medicamentos_posologia;
  }
  const medsRaw = String(previa.medicamentos || previa.medicamento || '').trim();
  const obsRaw = String(previa.observacoes || '').trim();
  const linhas = [];
  if (medsRaw) {
    const itens = medsRaw.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
    itens.forEach((item, idx) => {
      linhas.push(`${idx + 1}) ${item}`);
    });
  }
  if (obsRaw && (!medsRaw || !normText(medsRaw).includes(normText(obsRaw)))) {
    linhas.push(`Obs: ${obsRaw}`);
  }
  return linhas.join('\n');
}

let _tabelaReceitasCriada = false;
async function garantirTabelaReceitas(db) {
  if (_tabelaReceitasCriada) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS receitas_previas (
      id SERIAL PRIMARY KEY,
      patient_id INTEGER UNIQUE,
      tipo_receita TEXT DEFAULT 'branca',
      medicamentos TEXT,
      data_emissao TEXT,
      data_vencimento TEXT,
      dias_restantes INTEGER,
      urgencia TEXT DEFAULT 'normal',
      paciente_nome_ocr TEXT,
      paciente_cns TEXT,
      medico_emitente TEXT,
      confianca INTEGER,
      fila_sugerida TEXT,
      observacoes TEXT,
      imagem_base64 TEXT,
      dados_extras JSONB,
      anexos JSONB,
      status_revisao TEXT DEFAULT 'pendente',
      revisado_por TEXT,
      revisado_em TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query('ALTER TABLE receitas_previas ADD COLUMN IF NOT EXISTS dados_extras JSONB');
  await db.query('ALTER TABLE receitas_previas ADD COLUMN IF NOT EXISTS anexos JSONB');
  await db.query('ALTER TABLE receitas_previas ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP');
  _tabelaReceitasCriada = true;
}

const PREVIA_RETENCAO_HORAS = 24;
let _lastPreviaCleanupAt = 0;
const PREVIA_CLEANUP_THROTTLE_MS = 30 * 60 * 1000;

async function limparPreviasExpiradas(db, horas = PREVIA_RETENCAO_HORAS) {
  if (!db || typeof db.query !== 'function') return 0;
  const horasInt = Number.isFinite(Number(horas)) && Number(horas) > 0 ? Math.floor(Number(horas)) : PREVIA_RETENCAO_HORAS;
  try {
    const tblRes = await db.query("SELECT to_regclass('public.receitas_previas') AS tbl");
    if (!tblRes?.rows?.[0]?.tbl) return 0;
    await db.query('ALTER TABLE receitas_previas ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP');
    const delRes = await db.query(
      `DELETE FROM receitas_previas
       WHERE COALESCE(updated_at, created_at) < (CURRENT_TIMESTAMP - ($1 || ' hours')::interval)`,
      [horasInt]
    );
    return delRes?.rowCount || 0;
  } catch (err) {
    console.warn('[receitas] Aviso ao limpar prévias expiradas:', err.message);
    return 0;
  }
}

function limparPreviasExpiradasThrottled(db, horas = PREVIA_RETENCAO_HORAS) {
  const now = Date.now();
  if (now - _lastPreviaCleanupAt < PREVIA_CLEANUP_THROTTLE_MS) return Promise.resolve(0);
  _lastPreviaCleanupAt = now;
  return limparPreviasExpiradas(db, horas).catch(() => 0);
}

async function salvarPreviaReceita(db, patientId, previa) {
  if (!previa || typeof previa !== 'object') return null;
  await garantirTabelaReceitas(db);

  let tipoIn = previa.tipo_receita || 'branca';
  const meds = previa.medicamentos || previa.medicamento || null;
  const dataEmissao = previa.data_emissao || null;
  const anexos = normalizarAnexosPrevia(previa.anexos, previa.imagem_base64, tipoIn);
  if (anexos.some(a => a.categoria === 'receita_azul')) {
    tipoIn = 'azul';
  }
  const dadosExtras = normalizarDadosExtras(previa);
  const ehSisreg = normText(tipoIn) === 'sisreg' ||
    normText(dadosExtras?.destino_ia) === 'sisreg' ||
    normText(previa.fila_sugerida) === 'regulacao' ||
    (!meds && anexos.length > 0 && anexos.every(a => a.categoria === 'encaminhamento'));

  const clf = ehSisreg
    ? classificarDocumentoPrevia({
        destino_ia: 'sisreg',
        tipo_documento: 'encaminhamento',
        codigo_solicitacao: dadosExtras?.codigo_solicitacao,
        especialidade: dadosExtras?.especialidade
      })
    : classificarReceita(tipoIn, meds, dataEmissao);

  const img = anexos[0]?.imagem_base64 || (
    previa.imagem_base64 && String(previa.imagem_base64).length <= 3_500_000
      ? String(previa.imagem_base64)
      : null
  );

  const res = await db.query(
    `INSERT INTO receitas_previas (
       patient_id, tipo_receita, medicamentos, data_emissao, data_vencimento,
       dias_restantes, urgencia, paciente_nome_ocr, paciente_cns, medico_emitente,
       confianca, fila_sugerida, observacoes, imagem_base64, dados_extras, anexos, status_revisao
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16::jsonb, 'pendente')
     ON CONFLICT (patient_id) DO UPDATE SET
       tipo_receita = EXCLUDED.tipo_receita,
       medicamentos = EXCLUDED.medicamentos,
       data_emissao = EXCLUDED.data_emissao,
       data_vencimento = EXCLUDED.data_vencimento,
       dias_restantes = EXCLUDED.dias_restantes,
       urgencia = EXCLUDED.urgencia,
       paciente_nome_ocr = EXCLUDED.paciente_nome_ocr,
       paciente_cns = EXCLUDED.paciente_cns,
       medico_emitente = EXCLUDED.medico_emitente,
       confianca = EXCLUDED.confianca,
       fila_sugerida = EXCLUDED.fila_sugerida,
       observacoes = EXCLUDED.observacoes,
       imagem_base64 = COALESCE(EXCLUDED.imagem_base64, receitas_previas.imagem_base64),
       dados_extras = COALESCE(EXCLUDED.dados_extras, receitas_previas.dados_extras),
       anexos = COALESCE(EXCLUDED.anexos, receitas_previas.anexos),
       status_revisao = 'pendente',
       updated_at = CURRENT_TIMESTAMP
     RETURNING id, patient_id, tipo_receita, medicamentos, data_emissao, data_vencimento,
               dias_restantes, urgencia, paciente_nome_ocr, paciente_cns, medico_emitente,
               confianca, fila_sugerida, observacoes, dados_extras, status_revisao, revisado_por,
               (imagem_base64 IS NOT NULL AND LENGTH(imagem_base64) > 20) AS tem_imagem,
               CASE WHEN jsonb_typeof(anexos) = 'array' THEN jsonb_array_length(anexos)
                    WHEN imagem_base64 IS NOT NULL AND LENGTH(imagem_base64) > 20 THEN 1
                    ELSE 0 END AS qtd_anexos,
               CASE WHEN jsonb_typeof(anexos) = 'array' THEN
                 (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a->>'id', 'categoria', a->>'categoria', 'rotulo', a->>'rotulo', 'mime_type', a->>'mime_type', 'nome_arquivo', a->>'nome_arquivo')), '[]'::jsonb)
                  FROM jsonb_array_elements(anexos) AS a)
               ELSE NULL END AS anexos_meta`,
    [
      patientId,
      clf.tipo_receita,
      meds ? String(meds).trim().slice(0, 1500) : null,
      dataEmissao ? String(dataEmissao).trim().slice(0, 20) : null,
      clf.data_vencimento || previa.data_vencimento || null,
      clf.dias_restantes !== null ? clf.dias_restantes : (previa.dias_restantes ?? null),
      clf.urgencia || previa.urgencia || 'normal',
      previa.paciente_nome_ocr ? String(previa.paciente_nome_ocr).trim().slice(0, 180) : null,
      previa.paciente_cns ? String(previa.paciente_cns).trim().slice(0, 40) : null,
      previa.medico_emitente ? String(previa.medico_emitente).trim().slice(0, 180) : null,
      Number.isFinite(Number(previa.confianca)) ? Math.round(Number(previa.confianca)) : null,
      previa.fila_sugerida || clf.fila_destino,
      previa.observacoes ? String(previa.observacoes).trim().slice(0, 1000) : null,
      img,
      dadosExtras ? JSON.stringify(dadosExtras) : null,
      anexos.length > 0 ? JSON.stringify(anexos) : null
    ]
  );
  return res.rows[0] || null;
}

async function anexarResumoPrevias(rows, db) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  try {
    await garantirTabelaReceitas(db);
    limparPreviasExpiradasThrottled(db, PREVIA_RETENCAO_HORAS);
    const ids = rows.map(r => Number(r.id)).filter(n => Number.isInteger(n) && n > 0);
    if (ids.length === 0) return;

    const r = await db.query(
      `SELECT id, patient_id, tipo_receita, medicamentos, data_emissao, data_vencimento,
              dias_restantes, urgencia, paciente_nome_ocr, paciente_cns, medico_emitente, fila_sugerida,
              observacoes, dados_extras, status_revisao, revisado_por,
              (imagem_base64 IS NOT NULL AND LENGTH(imagem_base64) > 20) AS tem_imagem,
              CASE WHEN jsonb_typeof(anexos) = 'array' THEN jsonb_array_length(anexos)
                   WHEN imagem_base64 IS NOT NULL AND LENGTH(imagem_base64) > 20 THEN 1
                   ELSE 0 END AS qtd_anexos,
              CASE WHEN jsonb_typeof(anexos) = 'array' THEN
                (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a->>'id', 'categoria', a->>'categoria', 'rotulo', a->>'rotulo', 'mime_type', a->>'mime_type', 'nome_arquivo', a->>'nome_arquivo')), '[]'::jsonb)
                 FROM jsonb_array_elements(anexos) AS a)
              ELSE NULL END AS anexos_meta
       FROM receitas_previas
       WHERE patient_id = ANY($1::int[])`,
      [ids]
    );

    const map = new Map();
    r.rows.forEach(item => map.set(Number(item.patient_id), item));
    rows.forEach(p => {
      p.previa_receita = map.get(Number(p.id)) || null;
    });
  } catch (err) {
    console.warn('[receitas] Aviso ao anexar prévias:', err.message);
    rows.forEach(p => { p.previa_receita = p.previa_receita || null; });
  }
}

const PROMPT_OCR_RECEITA = `Você é um assistente especializado em leitura de documentos do SUS (Recife/PE):
- Receitas médicas e odontológicas (PEC, Receituário Branco, Receituário Azul / Controle Especial)
- Documentos de Regulação / SISREG III (Ficha de Solicitação Ambulatorial, Guia de Encaminhamento, Pedido de Exame ou Comprovante PDF do SISREG III).

Analise o arquivo (imagem ou PDF) e extraia os dados em JSON estrito:
{
  "destino_ia": "sisreg" se for Ficha de Solicitação Ambulatorial, Guia/Encaminhamento para especialidade/exame regulado ou PDF do SISREG III; "receita" se for prescrição/renovação de receita medicamentosa,
  "tipo_documento": "receita_branca" | "receita_azul" | "odonto" | "encaminhamento" | "exame" | "pdf_sisreg",
  "tipo_receita": "azul" | "branca" | "odonto" | "sisreg" | "incerto",
  "codigo_solicitacao": "código da solicitação SISREG se for PDF do SISREG, senão null",
  "medicamento": "nome completo dos medicamentos com dosagem separados por vírgula (null se for apenas encaminhamento SISREG)" | null,
  "medicamentos_posologia": "lista numerada com cada medicamento, dosagem e posologia completa por linha" | null,
  "data_emissao": "DD/MM/AAAA" | null,
  "paciente_nome": "nome completo do paciente" | null,
  "paciente_cns": "número do CNS ou CPF" | null,
  "paciente_endereco": "endereço completo do paciente se constar no documento" | null,
  "paciente_bairro": "bairro se visível" | null,
  "paciente_cep": "CEP se visível" | null,
  "paciente_municipio": "município de residência se visível" | null,
  "paciente_uf": "UF se visível" | null,
  "paciente_data_nascimento": "DD/MM/AAAA se visível" | null,
  "paciente_sexo": "M" | "F" | null,
  "paciente_telefone": "telefone com DDD se visível" | null,
  "paciente_mae": "nome da mãe se visível" | null,
  "medico_emitente": "nome do prescritor/solicitante e CRM/COREN/CRO se visível" | null,
  "especialidade": "especialidade médica ou procedimento/exame solicitado se for SISREG/encaminhamento/pedido" | null,
  "tipo_vaga": "primeira_vez" | "retorno" | null,
  "risco": "azul" | "verde" | "amarelo" | "vermelho" | null,
  "hipotese_diagnostica": "hipótese diagnóstica ou diagnóstico inicial se visível" | null,
  "cid10": "código CID-10 se visível" | null,
  "justificativa": "transcrição fiel de Condições Clínicas / Justificativa / Histórico de Observações" | null,
  "observacoes_revisada": "para encaminhamentos/SISREG: versão limpa e corrigida ortograficamente sem inventar dados clínicos (marque trechos ilegíveis com [CONFERIR: ...])" | null,
  "alertas_digitacao": ["avisos curtos sobre correções ortográficas ou palavras ilegíveis, ou []"],
  "confianca": número de 0 a 100,
  "observacoes": "posologia resumida, especialidade ou observações relevantes" | null
}
Se não tiver certeza ou o campo não aparecer no arquivo, retorne null nesse campo.`;

function setupReceitas(app, pool) {
  // Analisar foto ou PDF da prévia via Gemini Vision no backend (sem expor API key no frontend)
  app.post('/api/receita-previa/analisar', async (req, res) => {
    const rl = checkRateLimit('ocr_ai', getClientIp(req), 60, 60 * 1000);
    if (!rl.allowed) {
      return res.status(429).json({
        error: `Limite momentâneo de análises atingido. Aguarde ${rl.retryAfterSec}s e tente novamente.`
      });
    }
    const apiKey = (process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '').trim();
    const groqApiKey = (process.env.GROQ_API_KEY || '').trim();
    const raw = req.body?.arquivo_base64 || req.body?.imagem_base64;
    if (!raw || typeof raw !== 'string') {
      return res.status(400).json({ error: 'Arquivo (imagem ou PDF) é obrigatório.' });
    }
    if (raw.length > 4_400_000) {
      return res.status(400).json({ error: 'Arquivo muito grande. Envie foto ou PDF até 3 MB.' });
    }

    const mimeMatch = raw.match(/^data:([^;]+);base64,/i);
    const mimeType = mimeMatch ? mimeMatch[1].toLowerCase() : 'image/jpeg';
    if (!mimeType.startsWith('image/') && mimeType !== 'application/pdf') {
      return res.status(400).json({ error: 'Formato não suportado. Envie uma imagem (JPG/PNG) ou arquivo PDF.' });
    }

    if (!apiKey && !(groqApiKey && mimeType.startsWith('image/'))) {
      return res.json({
        ok: false,
        fallback_manual: true,
        error: 'Chave GEMINI_API_KEY não configurada no servidor. Preencha os campos manualmente e anexe o arquivo.'
      });
    }

    const base64Data = raw.includes(',') ? raw.split(',')[1] : raw;

    const ocrRes = await executarOcrGeminiJson({
      apiKey,
      groqApiKey,
      prompt: PROMPT_OCR_RECEITA,
      mimeType,
      base64Data,
      maxOutputTokens: 1800,
      cacheNamespace: 'receita'
    });

    if (ocrRes.ok && ocrRes.parsed) {
      const parsed = ocrRes.parsed;
      const catDetectada = normalizarCategoriaAnexo(parsed.tipo_documento || parsed.tipo_receita);
      const classificacao = classificarDocumentoPrevia({
        ...parsed,
        tipo_documento: parsed.tipo_documento || catDetectada
      });
      const tipoParaClassificacao = classificacao.categoria_destino === 'sisreg'
        ? 'sisreg'
        : (catDetectada === 'receita_azul' ? 'azul' : catDetectada === 'odonto' ? 'odonto' : (parsed.tipo_receita || 'branca'));

      return res.json({
        ok: true,
        provider: ocrRes.provider || 'gemini',
        model: ocrRes.model,
        cached: Boolean(ocrRes.fromCache),
        ocr: {
          destino_ia: classificacao.categoria_destino,
          tipo_documento: catDetectada,
          tipo_receita: tipoParaClassificacao,
          medicamento: parsed.medicamento || null,
          data_emissao: parsed.data_emissao || null,
          paciente_nome: parsed.paciente_nome || null,
          paciente_cns: parsed.paciente_cns || null,
          medico_emitente: parsed.medico_emitente || null,
          confianca: Number.isFinite(Number(parsed.confianca)) ? Number(parsed.confianca) : 70,
          observacoes: parsed.observacoes || null,
          dados_extras: normalizarDadosExtras({ ...parsed, destino_ia: classificacao.categoria_destino })
        },
        classificacao
      });
    }

    return res.json({
      ok: false,
      fallback_manual: true,
      error: ocrRes.error || 'Não foi possível ler o arquivo automaticamente. A foto foi mantida na prévia.'
    });
  });

  // Buscar prévia completa (com imagem_base64 e anexos) sob demanda apenas ao clicar no consultório
  app.get('/api/patients/:id/previa-receita', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    try {
      await garantirTabelaReceitas(pool);
      const patientId = parseInt(req.params.id, 10);
      const r = await pool.query('SELECT * FROM receitas_previas WHERE patient_id = $1', [patientId]);
      if (r.rows.length === 0) {
        return res.status(404).json({ error: 'Prévia de receita não encontrada para este paciente.' });
      }
      const row = r.rows[0];
      const anexosNorm = normalizarAnexosPrevia(row.anexos, row.imagem_base64, row.tipo_receita);
      row.anexos = anexosNorm;
      row.qtd_anexos = anexosNorm.length;
      row.anexos_meta = resumirAnexosSemImagem(anexosNorm);
      res.json(row);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Salvar ou atualizar prévia para um paciente já na fila
  app.post('/api/patients/:id/previa-receita', async (req, res) => {
    try {
      limparPreviasExpiradasThrottled(pool, PREVIA_RETENCAO_HORAS);
      const patientId = parseInt(req.params.id, 10);
      const saved = await salvarPreviaReceita(pool, patientId, req.body);
      res.json({ ok: true, previa: saved });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Marcar receita como revisada/pronta ou voltar para pendente no consultório
  app.put('/api/patients/:id/previa-receita/revisar', async (req, res) => {
    try {
      await garantirTabelaReceitas(pool);
      const patientId = parseInt(req.params.id, 10);
      const status = req.body?.status_revisao === 'pendente' ? 'pendente' : 'revisada';
      const revisadoPor = req.body?.revisado_por ? String(req.body.revisado_por).trim().slice(0, 100) : null;
      const r = await pool.query(
        `UPDATE receitas_previas
         SET status_revisao = $2,
             revisado_por = $3,
             revisado_em = CURRENT_TIMESTAMP
         WHERE patient_id = $1
         RETURNING id, patient_id, status_revisao, revisado_por, revisado_em`,
        [patientId, status, revisadoPor]
      );
      if (r.rows.length === 0) {
        return res.status(404).json({ error: 'Prévia não encontrada.' });
      }
      res.json({ ok: true, previa: r.rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Remover prévia de receita
  app.delete('/api/patients/:id/previa-receita', async (req, res) => {
    try {
      await garantirTabelaReceitas(pool);
      const patientId = parseInt(req.params.id, 10);
      await pool.query('DELETE FROM receitas_previas WHERE patient_id = $1', [patientId]);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = {
  MEDICAMENTOS_PADRAO,
  MAX_ANEXOS_PREVIA,
  calcularDataVencimento,
  calcularDiasRestantes,
  classificarUrgencia,
  classificarReceita,
  classificarDocumentoPrevia,
  normalizarCategoriaAnexo,
  normalizarAnexosPrevia,
  resumirAnexosSemImagem,
  normalizarDadosExtras,
  formatarPrescricaoParaFormulario,
  garantirTabelaReceitas,
  limparPreviasExpiradas,
  salvarPreviaReceita,
  anexarResumoPrevias,
  setupReceitas
};
