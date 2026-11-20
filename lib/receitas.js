// Módulo de Prévia de Receitas (Hiperdia & Renovação de Receita) — Integrado à Fila USF Chico Mendes

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
          todosEnfermeiro = false;
        }
      }
      fila_destino = todosEnfermeiro ? 'Enfermagem' : 'Médico';
    }
  }

  const data_vencimento = calcularDataVencimento(data_emissao, validade_meses);
  const dias_restantes = data_vencimento ? calcularDiasRestantes(data_vencimento, refDate) : null;
  const urgencia = classificarUrgencia(dias_restantes);

  return {
    tipo_receita: tipo,
    fila_destino,
    validade_meses,
    data_vencimento,
    dias_restantes,
    urgencia,
    medicamento_desconhecido,
    desconhecidos
  };
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
    paciente_mae: limparCampoExtra(src.paciente_mae || src.nome_mae, 180)
  };
  return Object.values(out).some(Boolean) ? out : null;
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
      status_revisao TEXT DEFAULT 'pendente',
      revisado_por TEXT,
      revisado_em TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query('ALTER TABLE receitas_previas ADD COLUMN IF NOT EXISTS dados_extras JSONB');
  _tabelaReceitasCriada = true;
}

async function salvarPreviaReceita(db, patientId, previa) {
  if (!previa || typeof previa !== 'object') return null;
  await garantirTabelaReceitas(db);

  const tipoIn = previa.tipo_receita || 'branca';
  const meds = previa.medicamentos || previa.medicamento || null;
  const dataEmissao = previa.data_emissao || null;
  const clf = classificarReceita(tipoIn, meds, dataEmissao);
  const dadosExtras = normalizarDadosExtras(previa);

  const img = previa.imagem_base64 && String(previa.imagem_base64).length <= 3_500_000
    ? String(previa.imagem_base64)
    : null;

  const res = await db.query(
    `INSERT INTO receitas_previas (
       patient_id, tipo_receita, medicamentos, data_emissao, data_vencimento,
       dias_restantes, urgencia, paciente_nome_ocr, paciente_cns, medico_emitente,
       confianca, fila_sugerida, observacoes, imagem_base64, dados_extras, status_revisao
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, 'pendente')
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
       status_revisao = 'pendente'
     RETURNING id, patient_id, tipo_receita, medicamentos, data_emissao, data_vencimento,
               dias_restantes, urgencia, paciente_nome_ocr, paciente_cns, medico_emitente,
               confianca, fila_sugerida, observacoes, dados_extras, status_revisao, revisado_por,
               (imagem_base64 IS NOT NULL AND LENGTH(imagem_base64) > 20) AS tem_imagem`,
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
      dadosExtras ? JSON.stringify(dadosExtras) : null
    ]
  );
  return res.rows[0] || null;
}

async function anexarResumoPrevias(rows, db) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  try {
    await garantirTabelaReceitas(db);
    const ids = rows.map(r => Number(r.id)).filter(n => Number.isInteger(n) && n > 0);
    if (ids.length === 0) return;

    const r = await db.query(
      `SELECT id, patient_id, tipo_receita, medicamentos, data_emissao, data_vencimento,
              dias_restantes, urgencia, paciente_nome_ocr, paciente_cns, medico_emitente, fila_sugerida,
              observacoes, dados_extras, status_revisao, revisado_por,
              (imagem_base64 IS NOT NULL AND LENGTH(imagem_base64) > 20) AS tem_imagem
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

const PROMPT_OCR_RECEITA = `Você é um assistente especializado em leitura de receitas médicas e odontológicas do SUS (PEC e Receituário Azul/Controle Especial). Analise a imagem da receita e extraia os dados em JSON estrito:
{
  "tipo_receita": "azul" | "branca" | "odonto" | "incerto",
  "medicamento": "nome completo dos medicamentos com dosagem separados por vírgula" | null,
  "medicamentos_posologia": "lista numerada com cada medicamento, dosagem e posologia completa por linha (ex: 1) Losartana 50mg - tomar 1 comprimido VO 12/12h)" | null,
  "data_emissao": "DD/MM/AAAA" | null,
  "paciente_nome": "nome completo do paciente (sob CIDADÃO/Paciente)" | null,
  "paciente_cns": "número do CNS ou CPF" | null,
  "paciente_endereco": "endereço completo do paciente se constar na receita" | null,
  "paciente_data_nascimento": "DD/MM/AAAA se visível" | null,
  "paciente_sexo": "M" | "F" | null,
  "paciente_telefone": "telefone do paciente se visível" | null,
  "paciente_mae": "nome da mãe se visível" | null,
  "medico_emitente": "nome do prescritor e CRM/COREN/CRO se visível" | null,
  "confianca": número de 0 a 100,
  "observacoes": "posologia resumida ou observações relevantes" | null
}
Se não tiver certeza ou o campo não aparecer na foto, retorne null nesse campo.`;

function setupReceitas(app, pool) {
  // Analisar foto da receita via Gemini Vision no backend (sem expor API key no frontend)
  app.post('/api/receita-previa/analisar', async (req, res) => {
    const apiKey = (process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '').trim();
    const { imagem_base64 } = req.body || {};
    if (!imagem_base64 || typeof imagem_base64 !== 'string') {
      return res.status(400).json({ error: 'Imagem da receita é obrigatória.' });
    }
    if (!apiKey) {
      return res.json({
        ok: false,
        fallback_manual: true,
        error: 'Chave GEMINI_API_KEY não configurada no servidor. Preencha os campos manualmente e anexe a foto.'
      });
    }

    const mimeType = imagem_base64.includes('data:')
      ? imagem_base64.split(';')[0].replace('data:', '')
      : 'image/jpeg';
    const base64Data = imagem_base64.includes(',') ? imagem_base64.split(',')[1] : imagem_base64;

    const models = [...new Set([
      process.env.GEMINI_MODEL,
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-flash-lite-latest',
      'gemini-3.5-flash'
    ].filter(Boolean))];

    let lastErrMsg = 'Não foi possível ler a imagem automaticamente.';
    for (const model of models) {
      try {
        const generationConfig = {
          temperature: 0.1,
          maxOutputTokens: 1400,
          responseMimeType: 'application/json'
        };
        if (/gemini-(3|flash-lite-latest|flash-latest)/i.test(model)) {
          generationConfig.thinkingConfig = { thinkingLevel: 'MINIMAL' };
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const apiRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: PROMPT_OCR_RECEITA },
                { inline_data: { mime_type: mimeType, data: base64Data } }
              ]
            }],
            generationConfig
          })
        });

        if (!apiRes.ok) {
          const errJson = await apiRes.json().catch(() => ({}));
          lastErrMsg = errJson?.error?.message || `Erro Gemini HTTP ${apiRes.status}`;
          continue;
        }

        const payload = await apiRes.json();
        const parts = payload?.candidates?.[0]?.content?.parts || [];
        const rawText = parts
          .filter(p => p && !p.thought && typeof p.text === 'string')
          .map(p => p.text)
          .join('\n')
          .trim() || parts[0]?.text || '';
        const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned);

        const classificacao = classificarReceita(
          parsed.tipo_receita || 'branca',
          parsed.medicamento || '',
          parsed.data_emissao || ''
        );

        return res.json({
          ok: true,
          model,
          ocr: {
            tipo_receita: parsed.tipo_receita || 'branca',
            medicamento: parsed.medicamento || null,
            data_emissao: parsed.data_emissao || null,
            paciente_nome: parsed.paciente_nome || null,
            paciente_cns: parsed.paciente_cns || null,
            medico_emitente: parsed.medico_emitente || null,
            confianca: Number.isFinite(Number(parsed.confianca)) ? Number(parsed.confianca) : 70,
            observacoes: parsed.observacoes || null,
            dados_extras: normalizarDadosExtras(parsed)
          },
          classificacao
        });
      } catch (err) {
        lastErrMsg = err.message || lastErrMsg;
      }
    }

    return res.json({
      ok: false,
      fallback_manual: true,
      error: `${lastErrMsg} Você ainda pode preencher os dados manualmente com a foto anexada.`
    });
  });

  // Buscar prévia completa (com imagem_base64) sob demanda apenas ao clicar no consultório
  app.get('/api/patients/:id/previa-receita', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    try {
      await garantirTabelaReceitas(pool);
      const patientId = parseInt(req.params.id, 10);
      const r = await pool.query('SELECT * FROM receitas_previas WHERE patient_id = $1', [patientId]);
      if (r.rows.length === 0) {
        return res.status(404).json({ error: 'Prévia de receita não encontrada para este paciente.' });
      }
      res.json(r.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Salvar ou atualizar prévia para um paciente já na fila
  app.post('/api/patients/:id/previa-receita', async (req, res) => {
    try {
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
  calcularDataVencimento,
  calcularDiasRestantes,
  classificarUrgencia,
  classificarReceita,
  normalizarDadosExtras,
  formatarPrescricaoParaFormulario,
  garantirTabelaReceitas,
  salvarPreviaReceita,
  anexarResumoPrevias,
  setupReceitas
};
