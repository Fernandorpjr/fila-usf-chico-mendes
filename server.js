// @ts-nocheck
if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (e) {}
}
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const http = require('http');
const app = express();
const server = http.createServer(app);

// Socket.io removido completamente para economizar Invocations/GB-h no Vercel
const io = { emit: () => {} };

const { setupDispositivos, getDeviceId } = require('./lib/dispositivos');
const { setupHistorico } = require('./lib/historico');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = 'chico123';
const ADMIN_PASSWORDS = ['chico123', '0177', 'usf2026'];
function isValidAdminPass(senha) {
  if (!senha) return false;
  return ADMIN_PASSWORDS.includes(String(senha).trim());
}

// ====== CONFIGURAÇÃO ÚNICA: PRIORIDADE POR IDADE (PARTE A) ======
const CONFIG_PRIORIDADE = {
  PROPORCAO_PRIORITARIOS: 1,
  LIMITE_ESPERA_NORMAL_MIN: 60
};

function calcularNivelPrioridade(idadeVal, prioridadeManual, tipoPrioridade, condicoesEspeciais) {
  let idadeNum = null;
  if (idadeVal !== undefined && idadeVal !== null && String(idadeVal).trim() !== '') {
    const parsed = Number(idadeVal);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 120) {
      return { erro: 'A idade deve ser um número inteiro entre 0 e 120 anos (ou ficar em branco).' };
    }
    idadeNum = parsed;
  }

  const tipoNorm = String(tipoPrioridade || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const condNorm = String(condicoesEspeciais || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  // Criança de colo (meses / idade 0 ou selecionada no tipo/condição) tem prioridade Nível 1 igual a 80+ anos
  const isCriancaColo =
    tipoNorm.includes('colo') ||
    condNorm.includes('crianca_colo') ||
    prioridadeManual === 'crianca_colo' ||
    (idadeNum !== null && idadeNum === 0);

  const temCondicaoPrioritaria =
    condNorm.includes('gestante') ||
    condNorm.includes('idoso') ||
    condNorm.includes('deficiencia') ||
    condNorm.includes('pcd') ||
    condNorm.includes('autismo') ||
    condNorm.includes('tea');

  let nivel = 3;
  if ((idadeNum !== null && idadeNum >= 80) || isCriancaColo) {
    nivel = 1;
  } else if (
    (idadeNum !== null && idadeNum >= 60 && idadeNum <= 79) ||
    prioridadeManual === 'prioritario' ||
    Boolean(tipoNorm) ||
    temCondicaoPrioritaria
  ) {
    nivel = 2;
  } else {
    nivel = 3;
  }

  let tipoResolvido = tipoPrioridade ? String(tipoPrioridade).trim() : null;
  if (nivel === 1) {
    if (isCriancaColo && (!tipoResolvido || !tipoNorm.includes('colo'))) {
      tipoResolvido = 'Criança de Colo';
    } else if (!tipoResolvido) {
      tipoResolvido = 'Idoso 80+ (Prioridade Especial)';
    }
  } else if (nivel === 2 && !tipoResolvido) {
    if (idadeNum !== null && idadeNum >= 60) tipoResolvido = 'Idoso 60+';
    else if (condNorm.includes('gestante')) tipoResolvido = 'Gestante';
    else if (condNorm.includes('autismo') || condNorm.includes('tea')) tipoResolvido = 'Autismo/TEA';
    else if (condNorm.includes('deficiencia') || condNorm.includes('pcd')) tipoResolvido = 'PCD';
  }

  return {
    idade: idadeNum,
    nivel,
    prioridade: nivel <= 2 ? 'prioritario' : 'geral',
    tipo_prioridade: tipoResolvido,
    is_crianca_colo: isCriancaColo
  };
}

function preservarOuElevarPrioridade(patientAntes, novosDados = {}) {
  const idadeEfetiva = novosDados.idade !== undefined && novosDados.idade !== null && String(novosDados.idade).trim() !== ''
    ? novosDados.idade
    : patientAntes?.idade;
  const prioManual = novosDados.prioridade || patientAntes?.prioridade || 'geral';
  const tipoPrio = novosDados.tipo_prioridade || patientAntes?.tipo_prioridade || null;
  const condEfetiva = novosDados.condicoes_especiais || patientAntes?.condicoes_especiais || null;

  const calc = calcularNivelPrioridade(idadeEfetiva, prioManual, tipoPrio, condEfetiva);
  const nivelAnterior = Number(patientAntes?.nivel_prioridade || (patientAntes?.prioridade === 'prioritario' ? 2 : 3));
  const nivelNovo = calc.erro ? nivelAnterior : Math.min(nivelAnterior, calc.nivel);
  const prioridadeFinal = nivelNovo <= 2 ? 'prioritario' : 'geral';
  const tipoFinal = calc.tipo_prioridade || patientAntes?.tipo_prioridade || null;

  return {
    nivel_prioridade: nivelNovo,
    prioridade: prioridadeFinal,
    tipo_prioridade: tipoFinal
  };
}

// ====== REGRAS DE PRIORIDADE E HORÁRIO MARCADO EXCLUSIVAS PARA ODONTOLOGIA (Lei nº 10.048/2000) ======
// Ordem estrita de Atendimento Prioritário conforme a imagem (1 a 10):
//  1. Idosos com 80 anos ou mais – prioridade especial.
//  2. Pessoas com deficiência – incluindo cadeirantes.
//  3. Pessoas com TEA.
//  4. Gestantes.
//  5. Lactantes.
//  6. Pessoas acompanhadas de criança de colo (incluindo bebês e crianças menores de 2 anos).
//  7. Pessoas com mobilidade reduzida.
//  8. Pessoas com obesidade.
//  9. Demais pessoas idosas (60 anos ou mais).
// 10. Doadores de sangue, após os demais grupos prioritários.
// 99. Atendimento Geral (sem prioridade legal).
function normalizarHorarioMarcado(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (m) {
    const hh = Math.min(23, Math.max(0, parseInt(m[1], 10)));
    const mm = m[2] ? Math.min(59, Math.max(0, parseInt(m[2], 10))) : 0;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  return s.slice(0, 5);
}

function calcularOrdemPrioridadeOdonto(idadeVal, prioridadeManual, tipoPrioridade, condicoesEspeciais) {
  let idadeNum = null;
  if (idadeVal !== undefined && idadeVal !== null && String(idadeVal).trim() !== '') {
    const parsed = Number(idadeVal);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 120) {
      idadeNum = parsed;
    }
  }

  const tipoNorm = String(tipoPrioridade || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const condNorm = String(condicoesEspeciais || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  const matches = [];

  // 1. Idosos com 80 anos ou mais – prioridade especial
  if (
    (idadeNum !== null && idadeNum >= 80) ||
    tipoNorm.includes('80') ||
    tipoNorm.startsWith('1.')
  ) {
    matches.push({ ordem: 1, label: '1. Idoso 80+ (Prioridade Especial)', nivel: 1 });
  }

  // 2. Pessoas com deficiência – incluindo cadeirantes
  if (
    tipoNorm.startsWith('2.') ||
    tipoNorm.includes('deficiencia') ||
    tipoNorm.includes('pcd') ||
    tipoNorm.includes('cadeirante') ||
    condNorm.includes('pcd') ||
    condNorm.includes('deficiencia')
  ) {
    matches.push({ ordem: 2, label: '2. Pessoa com Deficiência (PCD)', nivel: 2 });
  }

  // 3. Pessoas com TEA
  if (
    tipoNorm.startsWith('3.') ||
    tipoNorm.includes('tea') ||
    tipoNorm.includes('autismo') ||
    condNorm.includes('tea') ||
    condNorm.includes('autismo')
  ) {
    matches.push({ ordem: 3, label: '3. Pessoa com TEA', nivel: 2 });
  }

  // 4. Gestantes
  if (
    tipoNorm.startsWith('4.') ||
    tipoNorm.includes('gestante') ||
    condNorm.includes('gestante')
  ) {
    matches.push({ ordem: 4, label: '4. Gestante', nivel: 2 });
  }

  // 5. Lactantes
  if (
    tipoNorm.startsWith('5.') ||
    tipoNorm.includes('lactante') ||
    condNorm.includes('lactante')
  ) {
    matches.push({ ordem: 5, label: '5. Lactante', nivel: 2 });
  }

  // 6. Pessoas acompanhadas de criança de colo (incluindo bebês e crianças menores de 2 anos)
  if (
    tipoNorm.startsWith('6.') ||
    tipoNorm.includes('colo') ||
    condNorm.includes('crianca_colo') ||
    prioridadeManual === 'crianca_colo' ||
    (idadeNum !== null && idadeNum >= 0 && idadeNum < 2)
  ) {
    matches.push({ ordem: 6, label: '6. Criança de Colo (< 2 anos)', nivel: 2 });
  }

  // 7. Pessoas com mobilidade reduzida
  if (
    tipoNorm.startsWith('7.') ||
    tipoNorm.includes('mobilidade')
  ) {
    matches.push({ ordem: 7, label: '7. Mobilidade Reduzida', nivel: 2 });
  }

  // 8. Pessoas com obesidade
  if (
    tipoNorm.startsWith('8.') ||
    tipoNorm.includes('obesidade') ||
    tipoNorm.includes('obeso')
  ) {
    matches.push({ ordem: 8, label: '8. Obesidade', nivel: 2 });
  }

  // 9. Demais pessoas idosas (60 anos ou mais)
  if (
    tipoNorm.startsWith('9.') ||
    (idadeNum !== null && idadeNum >= 60 && idadeNum < 80) ||
    tipoNorm.includes('60') ||
    (tipoNorm.includes('idoso') && !tipoNorm.includes('80'))
  ) {
    matches.push({ ordem: 9, label: '9. Idoso 60+', nivel: 2 });
  }

  // 10. Doadores de sangue, após os demais grupos prioritários
  if (
    tipoNorm.startsWith('10.') ||
    tipoNorm.includes('doador') ||
    tipoNorm.includes('sangue')
  ) {
    matches.push({ ordem: 10, label: '10. Doador de Sangue', nivel: 2 });
  }

  if (matches.length > 0) {
    matches.sort((a, b) => a.ordem - b.ordem);
    const best = matches[0];
    return {
      ordem_prioridade_odonto: best.ordem,
      prioridade: 'prioritario',
      tipo_prioridade: best.label,
      nivel: best.nivel
    };
  }

  if (prioridadeManual === 'prioritario') {
    return {
      ordem_prioridade_odonto: 9,
      prioridade: 'prioritario',
      tipo_prioridade: tipoPrioridade ? String(tipoPrioridade).trim() : '9. Idoso 60+',
      nivel: 2
    };
  }

  return {
    ordem_prioridade_odonto: 99,
    prioridade: 'geral',
    tipo_prioridade: null,
    nivel: 3
  };
}

function sanitizarPacientePublico(p) {
  if (!p) return p;
  const clone = { ...p };
  delete clone.idade;
  delete clone.busca_ativa;
  delete clone.busca_ativa_ofertada;
  delete clone.busca_ativa_detalhes;
  delete clone.motivo_primeira_escuta;
  delete clone.observacao_segunda_escuta;
  return clone;
}

async function obterUsuarioDispositivo(req, dbClientOrPool, rotuloExtra) {
  try {
    const deviceId = getDeviceId(req);
    let deviceNome = 'Dispositivo não identificado';
    if (deviceId && dbClientOrPool) {
      const dRes = await dbClientOrPool.query('SELECT nome, setor FROM dispositivos WHERE id = $1', [deviceId]);
      if (dRes.rows.length > 0) {
        const r = dRes.rows[0];
        deviceNome = r.nome || 'Sem nome';
        if (r.setor && !rotuloExtra) rotuloExtra = r.setor;
      }
    }
    const extra = rotuloExtra ? ` (${rotuloExtra})` : '';
    return `${deviceNome}${extra}`.slice(0, 80);
  } catch (e) {
    return (rotuloExtra ? `Sistema (${rotuloExtra})` : 'Sistema').slice(0, 80);
  }
}

async function anexarBuscaAtivaDetalhes(rows, dbPool) {
  if (!rows || rows.length === 0) return rows;
  const idsComBusca = rows.filter(r => r.busca_ativa).map(r => r.id);
  if (idsComBusca.length === 0) {
    rows.forEach(r => { r.busca_ativa_detalhes = []; });
    return rows;
  }
  try {
    const itensRes = await dbPool.query(
      `SELECT bi.id, bi.entrada_fila_id, bi.motivo_id, bi.texto_outro, bi.ofertado, bi.ofertado_por, bi.ofertado_em,
              m.descricao AS motivo_descricao, m.setor_sugerido
       FROM busca_ativa_itens bi
       JOIN motivos_busca_ativa m ON m.id = bi.motivo_id
       WHERE bi.entrada_fila_id = ANY($1::int[])
       ORDER BY bi.id ASC`,
      [idsComBusca]
    );
    const map = {};
    itensRes.rows.forEach(item => {
      if (!map[item.entrada_fila_id]) map[item.entrada_fila_id] = [];
      map[item.entrada_fila_id].push(item);
    });
    rows.forEach(r => {
      r.busca_ativa_detalhes = map[r.id] || [];
    });
  } catch (e) {
    rows.forEach(r => { r.busca_ativa_detalhes = []; });
  }
  return rows;
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ limit: '5mb', extended: true }));
app.use(express.static('public'));

// === BLOQUEIO POR HORÁRIO (06:00 - 20:00 BRT) ===
function isDentroDoHorario() {
  const date = new Date();
  const options = { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false };
  const formatter = new Intl.DateTimeFormat('pt-BR', options);
  const timeString = formatter.format(date);
  const hour = parseInt(timeString.split(':')[0], 10);
  return (hour >= 6 && hour < 20);
}

app.use('/api', (req, res, next) => {
  if (req.method === 'GET') {
    // Permite cache no Edge Server da Vercel por 3 segundos para abater requisições repetidas (Economia de Invocations)
    // EXCEÇÃO: Rotas administrativas, dispositivos ou histórico não devem ser expostas em cache público
    if (req.path.startsWith('/admin') || req.path.startsWith('/dispositivos') || req.path.startsWith('/agendamentos/historico') || req.path.startsWith('/motivos-busca-ativa') || req.path.includes('/busca-ativa') || req.path.startsWith('/config-prioridade')) {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    } else {
      res.set('Cache-Control', 'public, s-maxage=3, stale-while-revalidate=2');
    }
  } else {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
  }

  if (!isDentroDoHorario()) {
    return res.status(503).json({ 
      error: 'Sistema fora do horário de funcionamento (20:00 às 06:00). Banco de dados suspenso para economia.'
    });
  }
  
  next();
});


// Database setup
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3, // Allow a few connections for concurrent requests
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 15000 // 15s para acomodar cold start do Neon.tech (free tier)
});

// Setores válidos
const SETORES = ['Acolhimento', 'Farmácia', 'Regulação', 'Médico', 'Enfermagem', 'Odontologia', 'Téc. Enfermagem'];

// Canais de chat válidos
const CANAIS_CHAT = ['geral', 'recepcao', 'acolhimento', 'medico', 'enfermagem', 'odontologia', 'farmacia', 'regulacao', 'gerencia'];

// Create tables on startup
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS patients (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        setor TEXT NOT NULL,
        horario TEXT NOT NULL,
        status TEXT DEFAULT 'aguardando',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS call_history (
        id SERIAL PRIMARY KEY,
        patient_id INTEGER,
        nome TEXT NOT NULL,
        setor TEXT NOT NULL,
        horario_chamada TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        remetente TEXT NOT NULL,
        mensagem TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Chat avançado com canais (agora com suporte a anexos)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_channels (
        id SERIAL PRIMARY KEY,
        canal TEXT NOT NULL,
        autor TEXT NOT NULL,
        texto TEXT NOT NULL,
        urgente BOOLEAN DEFAULT false,
        anexo_nome TEXT,
        anexo_base64 TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Assegura que colunas existam se a tabela já foi criada antes
    await pool.query('ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS anexo_nome TEXT');
    await pool.query('ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS anexo_base64 TEXT');

    // Leitura de mensagens por setor
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_leituras (
        canal TEXT NOT NULL,
        setor TEXT NOT NULL,
        last_read_id INTEGER DEFAULT 0,
        PRIMARY KEY (canal, setor)
      )
    `);

    /* === MELHORIA C: TABELAS DE PRESENÇA E PINS === */
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_presenca (
        setor TEXT PRIMARY KEY,
        last_seen TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_channel_pins (
        canal TEXT PRIMARY KEY,
        texto TEXT NOT NULL,
        autor TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    /* === FIM MELHORIA C: TABELAS === */

    /* === MELHORIA D: TABELA DE NOTIFICAÇÕES === */
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notificacoes (
        id SERIAL PRIMARY KEY,
        setor TEXT NOT NULL,
        titulo TEXT NOT NULL,
        mensagem TEXT NOT NULL,
        tipo TEXT DEFAULT 'presenca',
        patient_id INTEGER,
        dismissed BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    /* === FIM MELHORIA D: TABELA === */

    // Agendamentos
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agendamentos (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        telefone TEXT NOT NULL,
        data_agendamento DATE NOT NULL,
        horario TEXT NOT NULL,
        profissional TEXT,
        tipo_atendimento TEXT,
        template TEXT DEFAULT 'lembrete',
        observacoes TEXT,
        checklist_exames TEXT,
        status TEXT DEFAULT 'pendente',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Garantir colunas para cancelamento/reagendamento e histórico
    await pool.query(`ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS motivo_cancelamento TEXT`);
    await pool.query(`ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS data_original DATE`);
    await pool.query(`ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS horario_original TEXT`);
    await pool.query(`ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS cancelado_em TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS reagendado_em TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS cancelado_por TEXT`);
    await pool.query(`ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS arquivado BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS equipe TEXT`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS agendamento_historico (
        id SERIAL PRIMARY KEY,
        agendamento_id INTEGER,
        paciente TEXT,
        telefone TEXT,
        tipo_atendimento TEXT,
        profissional TEXT,
        status_anterior TEXT,
        novo_status TEXT NOT NULL,
        motivo TEXT,
        data_anterior DATE,
        horario_anterior TEXT,
        nova_data DATE,
        novo_horario TEXT,
        em_lote BOOLEAN DEFAULT false,
        criado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`ALTER TABLE agendamento_historico ADD COLUMN IF NOT EXISTS dispositivo_id UUID`);
    await pool.query(`ALTER TABLE agendamento_historico ADD COLUMN IF NOT EXISTS usuario TEXT`);
    await pool.query(`ALTER TABLE agendamento_historico ADD COLUMN IF NOT EXISTS arquivado BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE agendamento_historico ADD COLUMN IF NOT EXISTS arquivado_em TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE agendamento_historico ADD COLUMN IF NOT EXISTS vaga_reaproveitada BOOLEAN DEFAULT false`);

    // Tabela de dispositivos conectados
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dispositivos (
        id UUID PRIMARY KEY,
        nome TEXT DEFAULT 'Sem nome',
        setor TEXT,
        ultimo_ip TEXT,
        user_agent TEXT,
        primeiro_acesso TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        ultimo_acesso TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        ativo BOOLEAN DEFAULT true
      )
    `);

    // Histórico de logins / primeiros acessos diários por dispositivo
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dispositivo_acessos (
        id SERIAL PRIMARY KEY,
        dispositivo_id UUID REFERENCES dispositivos(id) ON DELETE CASCADE,
        ip TEXT,
        user_agent TEXT,
        tipo TEXT DEFAULT 'login',
        criado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabela de configurações (ex: prazo de retenção)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS configuracoes (
        chave TEXT PRIMARY KEY,
        valor TEXT NOT NULL
      )
    `);
    await pool.query(`
      INSERT INTO configuracoes (chave, valor)
      VALUES ('historico_retencao_dias', '30')
      ON CONFLICT (chave) DO NOTHING
    `);

    // ====== CTRL AGENDAMENTOS (Checklist interno – Sala de Agendamento) ======
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ctrl_agendamentos (
        id SERIAL PRIMARY KEY,
        patient_id   INTEGER,
        nome         TEXT NOT NULL,
        horario      TEXT NOT NULL,
        queixa       TEXT,
        equipe       TEXT,
        cpf6         TEXT,
        status       TEXT DEFAULT 'pendente',
        operador     TEXT DEFAULT 'Carlos',
        criado_em    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        atualizado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Compat: garantir que colunas existam em tabelas já criadas
    await pool.query(`ALTER TABLE ctrl_agendamentos ADD COLUMN IF NOT EXISTS queixa TEXT`);
    await pool.query(`ALTER TABLE ctrl_agendamentos ADD COLUMN IF NOT EXISTS equipe TEXT`);
    await pool.query(`ALTER TABLE ctrl_agendamentos ADD COLUMN IF NOT EXISTS cpf6 TEXT`);
    // Melhoria 3: colunas para encaminhamentos de outros setores
    await pool.query(`ALTER TABLE ctrl_agendamentos ADD COLUMN IF NOT EXISTS setor_origem TEXT`);
    await pool.query(`ALTER TABLE ctrl_agendamentos ADD COLUMN IF NOT EXISTS motivo TEXT`);
    await pool.query(`ALTER TABLE ctrl_agendamentos ADD COLUMN IF NOT EXISTS mes_agendamento INTEGER`);
    await pool.query(`ALTER TABLE ctrl_agendamentos ADD COLUMN IF NOT EXISTS ano_agendamento INTEGER`);
    // ====== FIM CTRL AGENDAMENTOS ======
    
    // Safe schema updates – ADD COLUMN IF NOT EXISTS for all new/existing columns
    const columns = [
      { table: 'patients', column: 'medico', type: 'TEXT' },
      { table: 'patients', column: 'prioridade', type: "TEXT DEFAULT 'geral'" },
      { table: 'patients', column: 'tipo_prioridade', type: 'TEXT' },
      { table: 'patients', column: 'tipo_atendimento', type: 'TEXT' },
      { table: 'patients', column: 'consultorio', type: 'TEXT' },
      { table: 'patients', column: 'profissional', type: 'TEXT' },
      { table: 'call_history', column: 'medico', type: 'TEXT' },
      { table: 'call_history', column: 'prioridade', type: 'TEXT' },
      { table: 'call_history', column: 'tipo_prioridade', type: 'TEXT' },
      { table: 'call_history', column: 'tipo_atendimento', type: 'TEXT' },
      { table: 'call_history', column: 'consultorio', type: 'TEXT' },
      { table: 'call_history', column: 'profissional', type: 'TEXT' },
      // Acolhimento workflow columns
      { table: 'patients', column: 'etapa_fluxo', type: "TEXT DEFAULT 'recepcao'" },
      { table: 'patients', column: 'queixa', type: 'TEXT' },
      { table: 'patients', column: 'risco_clinico', type: "TEXT DEFAULT 'verde'" },
      { table: 'patients', column: 'acs_responsavel', type: 'TEXT' },
      { table: 'patients', column: 'profissional_destino', type: 'TEXT' },
      { table: 'patients', column: 'tipo_profissional_destino', type: 'TEXT' },
      { table: 'patients', column: 'inicio_etapa', type: 'TIMESTAMPTZ' },
      { table: 'patients', column: 'cpf', type: 'TEXT' },
      { table: 'patients', column: 'cartao_sus', type: 'TEXT' },
      { table: 'patients', column: 'gravidade_final', type: 'TEXT' },
      { table: 'patients', column: 'agendamento_realizado', type: 'BOOLEAN DEFAULT false' },
      { table: 'patients', column: 'condicoes_especiais', type: 'TEXT' },
      { table: 'call_history', column: 'cpf', type: 'TEXT' },
      { table: 'call_history', column: 'cartao_sus', type: 'TEXT' },
      { table: 'call_history', column: 'gravidade_final', type: 'TEXT' },
      { table: 'call_history', column: 'acs_responsavel', type: 'TEXT' },
      { table: 'call_history', column: 'agendamento_realizado', type: 'BOOLEAN DEFAULT false' },
      { table: 'call_history', column: 'condicoes_especiais', type: 'TEXT' },
      { table: 'call_history', column: 'queixa', type: 'TEXT' },
      { table: 'call_history', column: 'risco_clinico', type: 'TEXT' },
      // Melhoria E: Confirmação de presença
      { table: 'patients', column: 'presenca_confirmada', type: 'BOOLEAN DEFAULT false' },
      // Melhoria G: Posição manual da fila (RBAC Admin)
      { table: 'patients', column: 'sort_order', type: 'INTEGER' },
      // Histórico de origem
      { table: 'patients', column: 'origem_transferencia', type: 'TEXT' },
    ];
    
    for (const col of columns) {
      await pool.query(`ALTER TABLE ${col.table} ADD COLUMN IF NOT EXISTS ${col.column} ${col.type}`);
    }

    // Convert existing TIMESTAMP columns to TIMESTAMPTZ (assuming current data is UTC)
    const tablesToMigrate = ['patients', 'call_history', 'chat_messages'];
    for (const table of tablesToMigrate) {
      // Check column type before altering
      const typeResult = await pool.query(`
        SELECT data_type FROM information_schema.columns 
        WHERE table_name = $1 AND column_name = 'created_at'
      `, [table]);
      
      if (typeResult.rows.length > 0 && typeResult.rows[0].data_type !== 'timestamp with time zone') {
        console.log(`🌀 Migrando ${table}.created_at para TIMESTAMPTZ...`);
        await pool.query(`ALTER TABLE ${table} ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC'`);
      }
    }

    // Add updated_at column to patients
    await pool.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`);

    // ====== TÉCNICOS DE ENFERMAGEM ======
    await pool.query(`
      CREATE TABLE IF NOT EXISTS atendimentos_tec_enfermagem (
        id SERIAL PRIMARY KEY,
        profissional TEXT NOT NULL,
        servico TEXT NOT NULL,
        nome_paciente TEXT NOT NULL,
        observacoes TEXT,
        horario TEXT,
        status TEXT DEFAULT 'realizado',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ====== MELHORIA 3: VAGAS MENSAIS POR MÉDICO ======
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vagas_medicos (
        id SERIAL PRIMARY KEY,
        medico TEXT NOT NULL,
        mes INTEGER NOT NULL,
        ano INTEGER NOT NULL,
        vagas INTEGER DEFAULT 0,
        UNIQUE(medico, mes, ano)
      )
    `);
    // ====== FIM MELHORIA 3: TABELA ======

    // ====== MELHORIA 4: CHAMADAS DE VOZ REMOTAS ======
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pending_voice_calls (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        setor TEXT DEFAULT 'Agendamento',
        destino TEXT,
        processed BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // ====== FIM MELHORIA 4: TABELA ======

    // ====== CADASTRO DE PROFISSIONAIS (com profissão/cargo) ======
    await pool.query(`
      CREATE TABLE IF NOT EXISTS profissionais_cadastro (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL UNIQUE,
        profissao TEXT,
        ativo BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Seed idempotente – preenche profissionais com profissão
    const profSeed = [
      ['Dra. Juliana Cavalcante', 'Cirurgiã-Dentista – Estratégia Saúde da Família'],
      ['Dra. Mirela Mota', 'Clínica Geral – Médica da Estratégia Saúde da Família'],
      ['Dr. Israel Christian', 'Médico – Estratégia Saúde da Família'],
      ['Dr. Joene Halan', 'Médico – Estratégia Saúde da Família'],
      ['Jorge Marcio', 'Enfermeiro – Estratégia Saúde da Família'],
      ['Mariana Vaz', 'Enfermeira – Estratégia Saúde da Família'],
      ['Lucelia de Abreu', 'Enfermeira – Estratégia Saúde da Família']
    ];
    for (const [nome, profissao] of profSeed) {
      await pool.query(
        `INSERT INTO profissionais_cadastro (nome, profissao) VALUES ($1, $2)
         ON CONFLICT (nome) DO UPDATE SET profissao = $2`,
        [nome, profissao]
      );
    }
    // ====== FIM CADASTRO DE PROFISSIONAIS ======

    // ====== RESPONSÁVEIS DE SETORES DE APOIO ======
    await pool.query(`
      CREATE TABLE IF NOT EXISTS responsaveis_setor (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        setor TEXT NOT NULL,
        cargo TEXT,
        ativo BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(nome, setor)
      )
    `);
    // Seed: Vivi (Regulação) e Leandra (Farmácia)
    // Atualiza registro legado 'Viviane' → 'Vivi' se existir
    await pool.query(
      `UPDATE responsaveis_setor SET nome = 'Vivi' WHERE nome = 'Viviane' AND setor = 'Regulação'`
    );
    await pool.query(
      `INSERT INTO responsaveis_setor (nome, setor, cargo) VALUES ('Vivi', 'Regulação', 'Responsável pela Regulação')
       ON CONFLICT (nome, setor) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO responsaveis_setor (nome, setor, cargo) VALUES ('Leandra', 'Farmácia', 'Responsável pela Farmácia')
       ON CONFLICT (nome, setor) DO NOTHING`
    );
    // ====== FIM RESPONSÁVEIS DE SETORES ======

    // ====== MENSAGENS ENVIADAS (Relatório) ======
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mensagens_enviadas (
        id SERIAL PRIMARY KEY,
        agendamento_id INTEGER,
        profissional TEXT,
        paciente TEXT NOT NULL,
        template TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // ====== FIM MENSAGENS ENVIADAS ======

    // ====== PARTE A: PRIORIDADE POR IDADE ======
    await pool.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS idade SMALLINT NULL`);
    await pool.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS nivel_prioridade SMALLINT NOT NULL DEFAULT 3`);
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_patients_idade') THEN
          ALTER TABLE patients ADD CONSTRAINT chk_patients_idade CHECK (idade IS NULL OR (idade >= 0 AND idade <= 120));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_patients_nivel_prioridade') THEN
          ALTER TABLE patients ADD CONSTRAINT chk_patients_nivel_prioridade CHECK (nivel_prioridade IN (1, 2, 3));
        END IF;
      END $$;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS log_prioridade (
        id SERIAL PRIMARY KEY,
        paciente_id INT REFERENCES patients(id) ON DELETE SET NULL,
        setor VARCHAR(60) NOT NULL,
        filtro_profissional TEXT,
        idade_informada SMALLINT,
        nivel_calculado SMALLINT NOT NULL,
        regra_aplicada CHAR(1) NOT NULL CHECK (regra_aplicada IN ('a', 'b', 'c', 'd')),
        espera_min NUMERIC(10,2),
        usuario_dispositivo VARCHAR(80),
        data_hora TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_log_prioridade_setor_data ON log_prioridade(setor, data_hora DESC)`);
    // ====== FIM PARTE A ======

    // ====== PARTE B: BUSCA ATIVA (alumIA) ======
    await pool.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS busca_ativa BOOLEAN NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS busca_ativa_ofertada BOOLEAN NOT NULL DEFAULT false`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS motivos_busca_ativa (
        id SERIAL PRIMARY KEY,
        descricao VARCHAR(120) NOT NULL UNIQUE,
        setor_sugerido VARCHAR(60) NOT NULL,
        ativo BOOLEAN NOT NULL DEFAULT true
      )
    `);

    const motivosSeed = [
      ['Criança com vacina em atraso: completar vacinação', 'Sala de vacina'],
      ['Criança: puericultura em atraso', 'Enfermagem'],
      ['Hipertenso: consulta de acompanhamento', 'Enfermagem/Clínico'],
      ['Diabético: consulta de acompanhamento', 'Enfermagem/Clínico'],
      ['Diabético ou hipertenso: retirar medicamento na farmácia', 'Farmácia'],
      ['Gestante: pré-natal em atraso', 'Enfermagem'],
      ['Puérpera: consulta pós-parto pendente', 'Enfermagem'],
      ['Rastreamento de câncer em atraso', 'Enfermagem'],
      ['Saúde bucal: consulta ou procedimento pendente', 'Odontologia'],
      ['Outro', 'Geral']
    ];
    for (const [descricao, setor_sugerido] of motivosSeed) {
      await pool.query(
        `INSERT INTO motivos_busca_ativa (descricao, setor_sugerido, ativo)
         VALUES ($1, $2, true)
         ON CONFLICT (descricao) DO NOTHING`,
        [descricao, setor_sugerido]
      );
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS busca_ativa_itens (
        id SERIAL PRIMARY KEY,
        entrada_fila_id INT REFERENCES patients(id) ON DELETE CASCADE,
        motivo_id INT REFERENCES motivos_busca_ativa(id),
        texto_outro VARCHAR(120),
        ofertado BOOLEAN DEFAULT false,
        ofertado_por VARCHAR(80),
        ofertado_em TIMESTAMPTZ
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_busca_ativa_itens_fila ON busca_ativa_itens(entrada_fila_id)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS log_busca_ativa (
        id SERIAL PRIMARY KEY,
        acao VARCHAR(40) NOT NULL,
        entrada_fila_id INT,
        motivo_id INT,
        motivo_descricao VARCHAR(120),
        detalhes TEXT,
        usuario_dispositivo VARCHAR(80),
        data_hora TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_log_busca_ativa_data ON log_busca_ativa(data_hora DESC)`);
    // ====== FIM PARTE B ======

    // ====== FLUXO 1ª ESCUTA (RECEPÇÃO) & 2ª ESCUTA (INTERCORRÊNCIA DO ACOLHIMENTO) ======
    await garantirColunasEscuta(pool);
    // ====== FIM FLUXO 1ª & 2ª ESCUTA ======

    console.log('✅ Banco de dados inicializado com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao inicializar banco de dados:', error.message);
  }
}

let _colunasEscutaGarantidas = false;
async function garantirColunasEscuta(dbClientOrPool) {
  if (_colunasEscutaGarantidas) return;
  const runner = dbClientOrPool || pool;
  try {
    await runner.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS equipe_paciente TEXT`);
    await runner.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS motivo_primeira_escuta TEXT`);
    await runner.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS observacao_segunda_escuta TEXT`);
    await runner.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS is_intercorrencia_acolhimento BOOLEAN NOT NULL DEFAULT false`);
    await runner.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS setor_destino TEXT`);
    await runner.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS profissional_destino TEXT`);
    await runner.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS horario_marcado TEXT`);
    await runner.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS ordem_prioridade_odonto SMALLINT`);

    await runner.query(`ALTER TABLE call_history ADD COLUMN IF NOT EXISTS equipe_paciente TEXT`);
    await runner.query(`ALTER TABLE call_history ADD COLUMN IF NOT EXISTS motivo_primeira_escuta TEXT`);
    await runner.query(`ALTER TABLE call_history ADD COLUMN IF NOT EXISTS observacao_segunda_escuta TEXT`);
    await runner.query(`ALTER TABLE call_history ADD COLUMN IF NOT EXISTS is_intercorrencia_acolhimento BOOLEAN DEFAULT false`);
    await runner.query(`ALTER TABLE call_history ADD COLUMN IF NOT EXISTS horario_marcado TEXT`);
    _colunasEscutaGarantidas = true;
  } catch (e) {
    console.warn('[garantirColunasEscuta] Aviso ao verificar colunas:', e.message);
  }
}

function inferirProfissionalPorEquipe(setorReal, equipePaciente, profExplicito) {
  if (profExplicito && String(profExplicito).trim() && String(profExplicito).trim() !== '__TODOS__') {
    return String(profExplicito).trim();
  }
  if (profExplicito === '__TODOS__') return null;
  if (setorReal === 'Odontologia') return 'Dra. Juliana Cavalcante';
  const eq = String(equipePaciente || '').toLowerCase();
  if (setorReal === 'Médico') {
    if (eq.includes('chico mendes') || eq.includes('eq 1') || eq.includes('equipe 1') || eq.includes('equipe i')) return 'Dr. Israel Christian';
    if (eq.includes('ximbor') || eq.includes('eq 2') || eq.includes('equipe 2') || eq.includes('equipe ii')) return 'Dr. Joene Halan';
    if (eq.includes('aurora') || eq.includes('eq 3') || eq.includes('equipe 3') || eq.includes('equipe iii')) return 'Dra. Mirela Mota';
  }
  if (setorReal === 'Enfermagem') {
    if (eq.includes('chico mendes') || eq.includes('eq 1') || eq.includes('equipe 1') || eq.includes('equipe i')) return 'Mariana Vaz';
    if (eq.includes('ximbor') || eq.includes('eq 2') || eq.includes('equipe 2') || eq.includes('equipe ii')) return 'Jorge Marcio';
    if (eq.includes('aurora') || eq.includes('eq 3') || eq.includes('equipe 3') || eq.includes('equipe iii')) return 'Lucelia de Abreu';
  }
  return null;
}

initDB();

// Configurar módulos integrados
setupDispositivos(app, pool, isValidAdminPass);
setupHistorico(app, pool, isValidAdminPass);

// ====== API Routes ======

// Healthcheck leve para o semáforo de internet no frontend (sem tocar no banco)
app.get('/api/health', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({ ok: true, ts: Date.now() });
});

// Verify admin password
app.post('/api/verify-admin', (req, res) => {
  const { senha } = req.body;
  if (isValidAdminPass(senha)) {
    res.json({ valid: true });
  } else {
    res.status(403).json({ valid: false, error: 'Senha incorreta' });
  }
});

// Get config de prioridade (Parte A)
app.get('/api/config-prioridade', (req, res) => {
  res.json(CONFIG_PRIORIDADE);
});

// Get all queues (sorted: priority level first, then arrival order)
// ====== ORDEM PADRÃO DA FILA (única fonte de verdade para tela, QR Code e reordenação) ======
// - sort_order (posição manual, fixação de prioridade no topo ou exceção de 3ª posição) vem sempre primeiro;
// - Pacientes com prioridade legal/clínica (Nível 1: 80+ / Criança de Colo; Nível 2: 60+ / Gestante / TEA / PCD)
//   mantêm SEMPRE sua prioridade na fila, mesmo quando encaminhados da 1ª e 2ª Escuta (Acolhimento);
// - Intercorrência SEM prioridade vinda da 2ª Escuta entra no FINAL da fila naquele instante (created_at = momento
//   da transferência) e segue o fluxo dinâmico conforme novos pacientes chegam.
const SQL_NIVEL_EFETIVO = `CASE WHEN COALESCE(nivel_prioridade, 3) IN (1, 2) THEN nivel_prioridade WHEN prioridade = 'prioritario' THEN 2 ELSE 3 END`;
const SQL_PRIO_EFETIVA = `CASE WHEN prioridade = 'prioritario' OR COALESCE(nivel_prioridade, 3) IN (1, 2) THEN 0 ELSE 1 END`;
const SQL_ODONTO_PRIO_RANK = `CASE
  WHEN setor = 'Odontologia' THEN COALESCE(ordem_prioridade_odonto, CASE WHEN COALESCE(nivel_prioridade, 3) = 1 THEN 1 WHEN prioridade = 'prioritario' OR COALESCE(nivel_prioridade, 3) = 2 THEN 9 ELSE 99 END)
  ELSE 99
END`;
const SQL_ODONTO_HORARIO_MARCADO = `CASE
  WHEN setor = 'Odontologia' THEN COALESCE(NULLIF(TRIM(horario_marcado), ''), '99:99')
  ELSE '00:00'
END`;
const SQL_ORDEM_FILA = `
         CASE WHEN sort_order IS NOT NULL THEN 0 ELSE 1 END ASC,
         COALESCE(sort_order, 2147483647) ASC,
         ${SQL_ODONTO_PRIO_RANK} ASC,
         ${SQL_NIVEL_EFETIVO} ASC,
         ${SQL_PRIO_EFETIVA} ASC,
         ${SQL_ODONTO_HORARIO_MARCADO} ASC,
         created_at ASC,
         id ASC`;

// Reordena automaticamente a fila de Odontologia segundo a regra em teste:
// 1º Preferenciais na ordem estrita de 1 a 10 da Lei nº 10.048/2000 (desempatando por horário marcado e chegada);
// 2º Pacientes sem prioridade ordenados pelo Horário Marcado (ex: 09:00 antes de 10:00) e depois pelo Horário de Chegada
//    (ex: Fernando marcado 09:00 chegou 09:00 -> Andreia marcada 09:00 chegou 09:20 -> Carlos marcado 10:00 chegou 07:00).
async function reordenarFilaOdontologia(db) {
  const res = await db.query(
    `SELECT id, idade, prioridade, tipo_prioridade, condicoes_especiais, ordem_prioridade_odonto, horario_marcado, created_at
     FROM patients
     WHERE setor = 'Odontologia' AND status = 'aguardando'`
  );
  if (res.rows.length === 0) return;

  const rows = res.rows.map(r => {
    let rank = Number(r.ordem_prioridade_odonto);
    if (!Number.isInteger(rank) || rank < 1 || rank > 99) {
      const calcOdonto = calcularOrdemPrioridadeOdonto(r.idade, r.prioridade, r.tipo_prioridade, r.condicoes_especiais);
      rank = calcOdonto.ordem_prioridade_odonto;
    }
    const hm = normalizarHorarioMarcado(r.horario_marcado) || '99:99';
    const createdMs = r.created_at ? new Date(r.created_at).getTime() : 0;
    return { id: r.id, rank, hm, createdMs };
  });

  rows.sort((a, b) => {
    // 1. Grupo Preferencial (1 a 10) sempre na frente do Geral (99), seguindo a ordem 1 -> 10 da imagem
    if (a.rank !== b.rank) return a.rank - b.rank;
    // 2. Dentro da mesma categoria (ou entre pacientes Gerais): Horário Marcado primeiro (ex: 09:00 antes de 10:00)
    if (a.hm !== b.hm) return a.hm.localeCompare(b.hm);
    // 3. Mesmo horário marcado: ordem de chegada (ex: chegou 09:00 antes de quem chegou 09:20)
    if (a.createdMs !== b.createdMs) return a.createdMs - b.createdMs;
    return a.id - b.id;
  });

  for (let i = 0; i < rows.length; i++) {
    await db.query(
      'UPDATE patients SET sort_order = $1, ordem_prioridade_odonto = $2 WHERE id = $3',
      [i + 1, rows[i].rank, rows[i].id]
    );
  }
}

// Garante que pacientes prioritários fiquem fixados no topo da fila (acima dos pacientes normais, mesmo quando
// já existiam pacientes na fila com sort_order preenchido).
async function fixarPrioritarioNoTopoDaFila(db, patient, { fixarPrimeiroDireto = false } = {}) {
  if (!patient || !patient.id || !patient.setor) return;
  const nv = Number(patient.nivel_prioridade || (patient.prioridade === 'prioritario' ? 2 : 3));
  const isPrio = nv <= 2 || patient.prioridade === 'prioritario';
  if (!isPrio) return;

  const meuNivel = nv === 1 ? 1 : 2;
  const params = [patient.setor];
  let filtroProfSql = '';
  if (patient.profissional && String(patient.profissional).trim()) {
    params.push(String(patient.profissional).trim());
    filtroProfSql = ` AND (profissional = $2 OR profissional IS NULL OR profissional = '')`;
  }

  const filaRes = await db.query(
    `SELECT id, nivel_prioridade, prioridade, sort_order
     FROM patients
     WHERE setor = $1 AND status = 'aguardando'${filtroProfSql}
     ORDER BY ${SQL_ORDEM_FILA}`,
    params
  );

  const outros = filaRes.rows.filter(r => Number(r.id) !== Number(patient.id));
  const obterNivelRow = (r) => {
    const n = Number(r.nivel_prioridade || 3);
    if (n === 1) return 1;
    if (n === 2 || r.prioridade === 'prioritario') return 2;
    return 3;
  };

  let insertIdx = 0;
  if (fixarPrimeiroDireto) {
    if (meuNivel === 1) {
      // Superprioridade (80+ / Criança de Colo) inserida diretamente fixa como #1 absoluto
      insertIdx = 0;
    } else {
      // Prioridade inserida diretamente fixa como #1 (ou logo após Nível 1 se houver 80+/Criança de Colo aguardando)
      const firstNonNivel1 = outros.findIndex(r => obterNivelRow(r) > 1);
      insertIdx = firstNonNivel1 === -1 ? outros.length : firstNonNivel1;
    }
  } else {
    // Prioridade vinda do Acolhimento (1ª -> 2ª Escuta -> Médico) entra no grupo prioritário, acima de todos os normais
    const firstLowerPriority = outros.findIndex(r => obterNivelRow(r) > meuNivel);
    insertIdx = firstLowerPriority === -1 ? outros.length : firstLowerPriority;
  }

  const novaOrdem = [...outros];
  novaOrdem.splice(insertIdx, 0, { id: patient.id, nivel_prioridade: meuNivel, prioridade: 'prioritario' });

  for (let i = 0; i < novaOrdem.length; i++) {
    await db.query(
      'UPDATE patients SET sort_order = $1 WHERE id = $2',
      [i + 1, novaOrdem[i].id]
    );
  }
  patient.sort_order = insertIdx + 1;
}

// Setores com a regra de exceção da 3ª posição (botão "Chamar 3 Próximos")
function isParRegulacaoFarmacia(origem, destino) {
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const o = norm(origem), d = norm(destino);
  return (o.includes('regula') && d.includes('farm')) || (o.includes('farm') && d.includes('regula'));
}

app.get('/api/queues', async (req, res) => {
  try {
    await garantirColunasEscuta(pool);
    const queues = {};
    SETORES.forEach(s => queues[s] = []);

    const result = await pool.query(
      `SELECT *,
              ROUND(EXTRACT(EPOCH FROM (NOW() - created_at)) / 60.0, 1) AS espera_minutos
       FROM patients
       WHERE status NOT IN ('atendido', 'desistencia')
       ORDER BY
         CASE WHEN status = 'chamado' THEN 0 ELSE 1 END ASC,
         ${SQL_ORDEM_FILA}`
    );

    await anexarBuscaAtivaDetalhes(result.rows, pool);

    result.rows.forEach(patient => {
      if (queues[patient.setor]) {
        queues[patient.setor].push(patient);
      }
    });

    res.json(queues);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Autocomplete de pacientes (busca no histórico por nome, CPF ou Cartão SUS)
app.get('/api/patients/autocomplete', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2) {
      return res.json([]);
    }

    const searchParam = `%${q}%`;
    const result = await pool.query(
      `SELECT DISTINCT ON (nome) nome, cpf, cartao_sus, condicoes_especiais
       FROM (
         SELECT nome, cpf, cartao_sus, condicoes_especiais, created_at FROM call_history WHERE nome ILIKE $1 OR cpf ILIKE $1 OR cartao_sus ILIKE $1
         UNION ALL
         SELECT nome, cpf, cartao_sus, condicoes_especiais, created_at FROM patients WHERE nome ILIKE $1 OR cpf ILIKE $1 OR cartao_sus ILIKE $1
       ) AS historico_unificado
       ORDER BY nome, created_at DESC
       LIMIT 8`,
      [searchParam]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Iniciar consulta (marca paciente como em_consulta)
app.post('/api/patients/:id/iniciar-consulta', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE patients SET status = 'em_consulta', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Paciente não encontrado' });
    }
    io.emit('queueUpdate');
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Relatório diário de fechamento do expediente
app.get('/api/relatorio-diario', async (req, res) => {
  try {
    let dataFiltro = req.query.data ? String(req.query.data).trim() : '';
    if (!dataFiltro || dataFiltro === 'undefined' || dataFiltro === 'null') {
      dataFiltro = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    } else if (dataFiltro.includes('/')) {
      const parts = dataFiltro.split('/');
      if (parts.length === 3) {
        dataFiltro = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
      }
    }

    // Atendimentos por setor no dia
    let porSetorRows = [];
    try {
      const porSetor = await pool.query(
        `SELECT setor, COUNT(*) as total
         FROM call_history
         WHERE DATE(created_at AT TIME ZONE 'America/Sao_Paulo') = $1::date
         GROUP BY setor
         ORDER BY total DESC`,
        [dataFiltro]
      );
      porSetorRows = porSetor.rows;
    } catch (e) {
      console.warn('Erro em porSetor no relatorio-diario:', e.message);
    }

    // Atendimentos por profissional no dia (com mapeamento automático de responsáveis para Regulação e Farmácia)
    let porProfRows = [];
    try {
      // Corrigido: sem JOIN em responsaveis_setor para evitar multiplicação de linhas (COUNT duplo)
      const porProf = await pool.query(
        `SELECT 
           CASE 
             WHEN NULLIF(TRIM(COALESCE(c.profissional, c.medico, '')), '') IS NOT NULL 
                  AND TRIM(COALESCE(c.profissional, c.medico, '')) <> 'Não especificado'
               THEN TRIM(COALESCE(c.profissional, c.medico))
             WHEN c.setor ILIKE '%Regula%' THEN 'Vivi'
             WHEN c.setor ILIKE '%Farm%' THEN 'Leandra'
             ELSE 'Não especificado'
           END as profissional,
           c.setor,
           COUNT(*) as total
         FROM call_history c
         WHERE DATE(c.created_at AT TIME ZONE 'America/Sao_Paulo') = $1::date
         GROUP BY 
           CASE 
             WHEN NULLIF(TRIM(COALESCE(c.profissional, c.medico, '')), '') IS NOT NULL 
                  AND TRIM(COALESCE(c.profissional, c.medico, '')) <> 'Não especificado'
               THEN TRIM(COALESCE(c.profissional, c.medico))
             WHEN c.setor ILIKE '%Regula%' THEN 'Vivi'
             WHEN c.setor ILIKE '%Farm%' THEN 'Leandra'
             ELSE 'Não especificado'
           END,
           c.setor
         ORDER BY total DESC`,
        [dataFiltro]
      );
      porProfRows = porProf.rows;
    } catch (e) {
      console.warn('Erro em porProf no relatorio-diario:', e.message);
    }

    // Tipos de atendimento especiais (Intercorrências, Urgências, etc.)
    let porTipoRows = [];
    try {
      const porTipo = await pool.query(
        `SELECT tipo_atendimento, COUNT(*) as total
         FROM call_history
         WHERE DATE(created_at AT TIME ZONE 'America/Sao_Paulo') = $1::date AND tipo_atendimento IS NOT NULL
         GROUP BY tipo_atendimento
         ORDER BY total DESC`,
        [dataFiltro]
      );
      porTipoRows = porTipo.rows;
    } catch (e) {
      console.warn('Erro em porTipo no relatorio-diario:', e.message);
    }

    // Total de desistências no dia
    let totalDesistencias = 0;
    try {
      const desistencias = await pool.query(
        `SELECT COUNT(*) as total
         FROM patients
         WHERE status = 'desistencia' AND DATE(created_at AT TIME ZONE 'America/Sao_Paulo') = $1::date`,
        [dataFiltro]
      );
      totalDesistencias = parseInt(desistencias.rows[0]?.total || 0, 10);
    } catch (e) {
      console.warn('Erro em desistencias no relatorio-diario:', e.message);
    }

    // Total na sala de agendamentos no dia
    let agendamentosRows = [];
    try {
      const agendamentos = await pool.query(
        `SELECT status, COUNT(*) as total
         FROM ctrl_agendamentos
         WHERE DATE(criado_em AT TIME ZONE 'America/Sao_Paulo') = $1::date
         GROUP BY status`,
        [dataFiltro]
      );
      agendamentosRows = agendamentos.rows;
    } catch (e) {
      console.warn('Erro em agendamentos no relatorio-diario:', e.message);
    }

    // Total geral de atendidos
    const totalGeral = porSetorRows.reduce((acc, row) => acc + parseInt(row.total, 10), 0);

    // Atendidos por turno (manhã < 12h, tarde >= 12h)
    let totalManha = 0;
    let totalTarde = 0;
    try {
      const turnoManha = await pool.query(
        `SELECT COUNT(*) as total FROM call_history
         WHERE DATE(created_at AT TIME ZONE 'America/Sao_Paulo') = $1::date
         AND EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo') < 12`,
        [dataFiltro]
      );
      totalManha = parseInt(turnoManha.rows[0]?.total || 0, 10);
    } catch (e) {
      console.warn('Erro em turnoManha no relatorio-diario:', e.message);
    }

    try {
      const turnoTarde = await pool.query(
        `SELECT COUNT(*) as total FROM call_history
         WHERE DATE(created_at AT TIME ZONE 'America/Sao_Paulo') = $1::date
         AND EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo') >= 12`,
        [dataFiltro]
      );
      totalTarde = parseInt(turnoTarde.rows[0]?.total || 0, 10);
    } catch (e) {
      console.warn('Erro em turnoTarde no relatorio-diario:', e.message);
    }

    // Responsáveis de setores de apoio (Vivi -> Regulação, Leandra -> Farmácia)
    let responsaveisRows = [];
    try {
      const responsaveis = await pool.query(
        'SELECT nome, setor, cargo FROM responsaveis_setor WHERE ativo = true ORDER BY setor ASC, nome ASC'
      );
      if (responsaveis.rows && responsaveis.rows.length > 0) {
        responsaveisRows = responsaveis.rows;
      } else {
        responsaveisRows = [
          { nome: 'Vivi', setor: 'Regulação', cargo: 'Responsável pela Regulação' },
          { nome: 'Leandra', setor: 'Farmácia', cargo: 'Responsável pela Farmácia' }
        ];
      }
    } catch (e) {
      responsaveisRows = [
        { nome: 'Vivi', setor: 'Regulação', cargo: 'Responsável pela Regulação' },
        { nome: 'Leandra', setor: 'Farmácia', cargo: 'Responsável pela Farmácia' }
      ];
    }

    res.json({
      data: dataFiltro,
      totalAtendidos: totalGeral,
      atendidosManha: totalManha,
      atendidosTarde: totalTarde,
      porSetor: porSetorRows,
      porProfissional: porProfRows,
      porTipo: porTipoRows,
      desistencias: totalDesistencias,
      agendamentos: agendamentosRows,
      responsaveisSetor: responsaveisRows
    });
  } catch (error) {
    console.error('Erro geral em /api/relatorio-diario:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add patient
app.post('/api/patients', async (req, res) => {
  try {
    await garantirColunasEscuta(pool);
    const {
      nome,
      setor,
      prioridade,
      tipo_prioridade,
      tipo_atendimento,
      profissional,
      condicoes_especiais,
      etapa_fluxo,
      idade,
      equipe_paciente,
      motivo_primeira_escuta,
      queixa,
      horario_marcado
    } = req.body;

    if (!nome || !setor) {
      return res.status(400).json({ error: 'Nome e setor são obrigatórios' });
    }

    const calc = calcularNivelPrioridade(idade, prioridade, tipo_prioridade, condicoes_especiais);
    if (calc.erro) {
      return res.status(400).json({ error: calc.erro });
    }

    let prioridadeFinal = calc.prioridade;
    let tipoPrioridadeFinal = calc.tipo_prioridade;
    let nivelFinal = calc.nivel;
    let ordemPrioridadeOdontoFinal = null;
    let horarioMarcadoFinal = null;

    if (setor === 'Odontologia') {
      const calcOdonto = calcularOrdemPrioridadeOdonto(idade, prioridade, tipo_prioridade, condicoes_especiais);
      prioridadeFinal = calcOdonto.prioridade;
      tipoPrioridadeFinal = calcOdonto.tipo_prioridade;
      nivelFinal = calcOdonto.nivel;
      ordemPrioridadeOdontoFinal = calcOdonto.ordem_prioridade_odonto;
      horarioMarcadoFinal = normalizarHorarioMarcado(horario_marcado);
    }

    const horario = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    const equipeFinal = equipe_paciente ? String(equipe_paciente).trim().slice(0, 80) : null;
    const motivoEscuta1Final = motivo_primeira_escuta
      ? String(motivo_primeira_escuta).trim()
      : (queixa ? String(queixa).trim() : null);

    const result = await pool.query(
      `INSERT INTO patients (
         nome, setor, horario, status, prioridade, tipo_prioridade, tipo_atendimento,
         profissional, condicoes_especiais, etapa_fluxo, idade, nivel_prioridade,
         equipe_paciente, motivo_primeira_escuta, queixa, setor_destino, profissional_destino,
         horario_marcado, ordem_prioridade_odonto, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, CURRENT_TIMESTAMP)
       RETURNING *`,
      [
        nome,
        setor,
        horario,
        'aguardando',
        prioridadeFinal,
        tipoPrioridadeFinal,
        tipo_atendimento || null,
        profissional || null,
        condicoes_especiais || null,
        etapa_fluxo || 'recepcao',
        calc.idade,
        nivelFinal,
        equipeFinal,
        motivoEscuta1Final,
        motivoEscuta1Final,
        setor,
        profissional || null,
        horarioMarcadoFinal,
        ordemPrioridadeOdontoFinal
      ]
    );

    const novoPaciente = result.rows[0];
    if (setor === 'Odontologia') {
      await reordenarFilaOdontologia(pool);
    } else if (prioridadeFinal === 'prioritario') {
      await fixarPrioritarioNoTopoDaFila(pool, novoPaciente, { fixarPrimeiroDireto: true });
    }
    novoPaciente.busca_ativa_detalhes = [];

    io.emit('queueUpdate');

    res.status(201).json(novoPaciente);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Patient status for QR Code (público — lista explícita sem expor idade nem busca_ativa)
app.get('/api/patients/:id/status', async (req, res) => {
  try {
    await garantirColunasEscuta(pool);
    const { id } = req.params;
    
    const pResult = await pool.query(
      `SELECT id, nome, setor, horario, horario_marcado, ordem_prioridade_odonto, status, medico, consultorio, profissional,
              prioridade, tipo_prioridade, tipo_atendimento, etapa_fluxo, created_at, updated_at
       FROM patients WHERE id = $1`,
      [id]
    );
    if (pResult.rows.length === 0) return res.status(404).json({ error: 'Paciente não encontrado' });
    const p = pResult.rows[0];
    
    if (p.status !== 'aguardando') {
      return res.json({ patient: p, position: 0 });
    }
    
    const queueParams = [p.setor];
    let filtroProfSql = '';
    // Fila individualizada: se o paciente está vinculado a um profissional (ex.: Dr. Fulano),
    // a posição considera SOMENTE a fila daquele profissional (+ fila geral do setor, exatamente
    // como o profissional enxerga na tela dele). Não soma pacientes de outros médicos/consultórios.
    if (p.profissional && String(p.profissional).trim()) {
      queueParams.push(String(p.profissional).trim());
      filtroProfSql = ` AND (profissional = $2 OR profissional IS NULL OR profissional = '')`;
    }
    // Acolhimento: separa 1ª e 2ª escuta
    if (p.setor === 'Acolhimento' && p.etapa_fluxo) {
      queueParams.push(p.etapa_fluxo);
      filtroProfSql += ` AND etapa_fluxo = $${queueParams.length}`;
    }

    const queueResult = await pool.query(
      `SELECT id FROM patients 
       WHERE status = 'aguardando' AND setor = $1${filtroProfSql}
       ORDER BY ${SQL_ORDEM_FILA}`,
      queueParams
    );
    
    const position = queueResult.rows.findIndex(row => row.id == id) + 1;
    res.json({ patient: p, position, total_fila: queueResult.rows.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Call next patient (Algoritmo Parte A: Regras a, b, c, d com anti-starvation e alternância)
app.post('/api/call-next/:setor', async (req, res) => {
  const client = await pool.connect();
  try {
    const { setor } = req.params;
    const { medico, consultorio, profissional, filtro_profissional, filtro_etapa } = req.body || {};

    await client.query('BEGIN');

    let baseWhere = `setor = $1 AND status = 'aguardando'`;
    const baseParams = [setor];
    if (filtro_profissional) {
      baseParams.push(filtro_profissional);
      baseWhere += ` AND (profissional = $${baseParams.length} OR profissional IS NULL OR profissional = '')`;
    }
    if (filtro_etapa && setor === 'Acolhimento') {
      baseParams.push(filtro_etapa);
      baseWhere += ` AND etapa_fluxo = $${baseParams.length}`;
    }

    let chosenPatient = null;
    let regraAplicada = 'd';

    // === REGRA ESPECÍFICA EM TESTE PARA ODONTOLOGIA ===
    // Na Odontologia, respeita estritamente a ordem 1 a 10 da Lei nº 10.048/2000 + Horário Marcado + Chegada
    // (sem aplicar alternância 1x1 nem puxar paciente agendado para 10h que chegou às 7h antes do agendado das 9h).
    if (setor === 'Odontologia') {
      const odontoNextRes = await client.query(
        `SELECT *, EXTRACT(EPOCH FROM (NOW() - created_at)) / 60.0 AS espera_calc_min
         FROM patients
         WHERE ${baseWhere}
         ORDER BY ${SQL_ORDEM_FILA}
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        baseParams
      );
      if (odontoNextRes.rows.length > 0) {
        chosenPatient = odontoNextRes.rows[0];
        regraAplicada = chosenPatient.prioridade === 'prioritario' ? 'c' : 'd';
      }
    }

    // Prioridade manual do especialista / exceção de 3ª posição: se existe paciente com posição fixada (sort_order),
    // respeitar EXATAMENTE a ordem exibida na tela (menor sort_order primeiro).
    if (!chosenPatient) {
      const manualTopRes = await client.query(
        `SELECT *, EXTRACT(EPOCH FROM (NOW() - created_at)) / 60.0 AS espera_calc_min
         FROM patients
         WHERE ${baseWhere}
           AND sort_order IS NOT NULL
         ORDER BY sort_order ASC, created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        baseParams
      );
      if (manualTopRes.rows.length > 0) {
        chosenPatient = manualTopRes.rows[0];
        regraAplicada = 'd';
      }
    }

    // Regra (a): Há paciente normal (nivel_prioridade = 3) esperando no setor há mais de LIMITE_ESPERA_NORMAL_MIN minutos -> chamar o normal mais antigo (created_at ASC estrito)
    if (!chosenPatient) {
      const paramsRegraA = [...baseParams, CONFIG_PRIORIDADE.LIMITE_ESPERA_NORMAL_MIN];
      const regraARes = await client.query(
        `SELECT *, EXTRACT(EPOCH FROM (NOW() - created_at)) / 60.0 AS espera_calc_min
         FROM patients
         WHERE ${baseWhere}
           AND ${SQL_NIVEL_EFETIVO} = 3
           AND EXTRACT(EPOCH FROM (NOW() - created_at)) / 60.0 >= $${paramsRegraA.length}
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        paramsRegraA
      );

      if (regraARes.rows.length > 0) {
        chosenPatient = regraARes.rows[0];
        regraAplicada = 'a';
      }
    }

    // Regra (b): Os últimos PROPORCAO_PRIORITARIOS chamados daquele setor (+ filtro_profissional via COALESCE) foram prioritários (1 ou 2) E há normal esperando -> chamar o normal mais antigo
    if (!chosenPatient) {
      const filtroProfNorm = filtro_profissional ? String(filtro_profissional).trim() : '';
      const ultimosRes = await client.query(
        `SELECT nivel_calculado FROM log_prioridade
         WHERE setor = $1
           AND COALESCE(filtro_profissional, '') = COALESCE($2, '')
           AND DATE(data_hora AT TIME ZONE 'America/Recife') = (NOW() AT TIME ZONE 'America/Recife')::date
         ORDER BY data_hora DESC, id DESC
         LIMIT $3`,
        [setor, filtroProfNorm, CONFIG_PRIORIDADE.PROPORCAO_PRIORITARIOS]
      );

      const ultimosForamPrioritarios =
        ultimosRes.rows.length >= CONFIG_PRIORIDADE.PROPORCAO_PRIORITARIOS &&
        ultimosRes.rows.every(r => Number(r.nivel_calculado) === 1 || Number(r.nivel_calculado) === 2);

      if (ultimosForamPrioritarios) {
        const regraBRes = await client.query(
          `SELECT *, EXTRACT(EPOCH FROM (NOW() - created_at)) / 60.0 AS espera_calc_min
           FROM patients
           WHERE ${baseWhere}
             AND ${SQL_NIVEL_EFETIVO} = 3
           ORDER BY ${SQL_ORDEM_FILA}
           LIMIT 1
           FOR UPDATE SKIP LOCKED`,
          baseParams
        );
        if (regraBRes.rows.length > 0) {
          chosenPatient = regraBRes.rows[0];
          regraAplicada = 'b';
        }
      }
    }

    // Regra (c): Há prioritário (1 ou 2) esperando no setor (intercorrência sem reposicionamento manual conta como normal) -> chamar o de menor nível primeiro
    if (!chosenPatient) {
      const regraCRes = await client.query(
        `SELECT *, EXTRACT(EPOCH FROM (NOW() - created_at)) / 60.0 AS espera_calc_min
         FROM patients
         WHERE ${baseWhere}
           AND ${SQL_NIVEL_EFETIVO} IN (1, 2)
         ORDER BY ${SQL_ORDEM_FILA}
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        baseParams
      );
      if (regraCRes.rows.length > 0) {
        chosenPatient = regraCRes.rows[0];
        regraAplicada = 'c';
      }
    }

    // Regra (d): Caso contrário -> chamar o próximo da fila na mesma ordem exibida na tela
    if (!chosenPatient) {
      const regraDRes = await client.query(
        `SELECT *, EXTRACT(EPOCH FROM (NOW() - created_at)) / 60.0 AS espera_calc_min
         FROM patients
         WHERE ${baseWhere}
         ORDER BY ${SQL_ORDEM_FILA}
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        baseParams
      );
      if (regraDRes.rows.length > 0) {
        chosenPatient = regraDRes.rows[0];
        regraAplicada = 'd';
      }
    }

    if (!chosenPatient) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Nenhum paciente aguardando' });
    }

    const next = chosenPatient;

    let consultorioFinal = setor === 'Odontologia' ? 'Odontológico' : (consultorio || null);
    let profissionalFinal = profissional || null;
    if (!profissionalFinal) {
      if (setor === 'Odontologia') profissionalFinal = 'Dra. Juliana Cavalcante';
      else if (setor && setor.toLowerCase().includes('regula')) profissionalFinal = 'Vivi';
      else if (setor && setor.toLowerCase().includes('farm')) profissionalFinal = 'Leandra';
    }
    const medicoFinal = setor === 'Odontologia'
      ? `Consultório Odontológico - ${profissionalFinal}`
      : (medico || null);

    // Update patient status and assign medico/consultorio/profissional (limpa sort_order ao ser chamado)
    await client.query(
      "UPDATE patients SET status = 'chamado', sort_order = NULL, medico = $2, consultorio = $3, profissional = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [next.id, medicoFinal, consultorioFinal, profissionalFinal]
    );

    // Mark previous called as atendido
    await client.query(
      "UPDATE patients SET status = 'atendido', updated_at = CURRENT_TIMESTAMP WHERE setor = $1 AND status = 'chamado' AND id != $2",
      [setor, next.id]
    );

    // Add to history
    const horarioChamada = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    await client.query(
      `INSERT INTO call_history (patient_id, nome, setor, horario_chamada, medico, prioridade, tipo_prioridade, tipo_atendimento, consultorio, profissional)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [next.id, next.nome, setor, horarioChamada, medicoFinal, next.prioridade, next.tipo_prioridade, next.tipo_atendimento, consultorioFinal, profissionalFinal]
    );

    // Registrar auditoria em log_prioridade (Parte A) usando COALESCE($3, '') para filtro_profissional
    const usuarioDisp = await obterUsuarioDispositivo(req, client, profissionalFinal || medicoFinal || setor);
    const esperaMin = next.espera_calc_min !== undefined && next.espera_calc_min !== null
      ? Number(Number(next.espera_calc_min).toFixed(2))
      : 0;
    const filtroProfInsert = filtro_profissional ? String(filtro_profissional).trim() : '';
    await client.query(
      `INSERT INTO log_prioridade
         (paciente_id, setor, filtro_profissional, idade_informada, nivel_calculado, regra_aplicada, espera_min, usuario_dispositivo, data_hora)
       VALUES ($1, $2, COALESCE($3, ''), $4, $5, $6, $7, $8, NOW())`,
      [
        next.id,
        setor,
        filtroProfInsert,
        next.idade !== undefined ? next.idade : null,
        next.nivel_prioridade || 3,
        regraAplicada,
        esperaMin,
        usuarioDisp
      ]
    );

    await client.query('COMMIT');

    const updatedResult = await pool.query('SELECT * FROM patients WHERE id = $1', [next.id]);
    await anexarBuscaAtivaDetalhes(updatedResult.rows, pool);
    const nextPatient = updatedResult.rows[0];
    nextPatient.regra_aplicada = regraAplicada;

    // Emite atualização imediata
    io.emit('queueUpdate');

    // Libera a requisição IMEDIATAMENTE
    res.json(nextPatient);

    // Emissão de evento para painéis em background
    setTimeout(() => {
      io.emit('callPatient', { patient: sanitizarPacientePublico(nextPatient), setor, audioUrl: null });
    }, 100);

  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// ====== MELHORIA G: REORDENAÇÃO E TRANSFERÊNCIA (Admin RBAC) ======

// PUT /api/patients/:id/reorder — Reposicionar paciente na fila (requer senha admin)
app.put('/api/patients/:id/reorder', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { setor, newPosition, profissional, senha } = req.body;

    if (!isValidAdminPass(senha)) {
      return res.status(403).json({ error: 'Senha administrativa incorreta' });
    }
    if (!setor || !newPosition || isNaN(parseInt(newPosition))) {
      return res.status(400).json({ error: 'Setor e nova posição são obrigatórios' });
    }

    const pos = Math.max(1, parseInt(newPosition));

    await client.query('BEGIN');

    // Se o filtro de profissional não veio na requisição, usa o profissional do próprio paciente
    // para não misturar filas de médicos/consultórios diferentes.
    const targetRes = await client.query('SELECT id, profissional FROM patients WHERE id = $1', [id]);
    const profEfetivo = (profissional && String(profissional).trim())
      ? String(profissional).trim()
      : (targetRes.rows[0]?.profissional ? String(targetRes.rows[0].profissional).trim() : '');

    // Busca todos os pacientes aguardando neste setor (e profissional correspondente) na mesma ordem da tela
    const reorderParams = [setor];
    let profFilterSql = '';
    if (profEfetivo) {
      reorderParams.push(profEfetivo);
      profFilterSql = ` AND (profissional = $2 OR profissional IS NULL OR profissional = '')`;
    }

    const queueResult = await client.query(
      `SELECT id FROM patients
       WHERE setor = $1 AND status = 'aguardando'${profFilterSql}
       ORDER BY ${SQL_ORDEM_FILA}`,
      reorderParams
    );

    const ids = queueResult.rows.map(r => r.id);
    const currentIdx = ids.indexOf(parseInt(id));
    if (currentIdx === -1) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Paciente não encontrado na fila do setor informado' });
    }

    // Remove da posição atual e insere na nova
    ids.splice(currentIdx, 1);
    const targetIdx = Math.min(pos - 1, ids.length);
    ids.splice(targetIdx, 0, parseInt(id));

    // Reatribui sort_order sequencial para toda a fila
    for (let i = 0; i < ids.length; i++) {
      await client.query(
        'UPDATE patients SET sort_order = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [i + 1, ids[i]]
      );
    }

    await client.query('COMMIT');
    io.emit('queueUpdate');
    res.json({ message: 'Fila reordenada com sucesso', newOrder: ids });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// PUT /api/patients/:id/rename — Editar nome do paciente (requer senha admin)
app.put('/api/patients/:id/rename', async (req, res) => {
  try {
    const { id } = req.params;
    const { novoNome, senha } = req.body;
    if (!isValidAdminPass(senha)) {
      return res.status(403).json({ error: 'Senha administrativa incorreta' });
    }
    if (!novoNome || !novoNome.trim()) {
      return res.status(400).json({ error: 'O novo nome é obrigatório' });
    }
    const result = await pool.query(
      `UPDATE patients SET nome = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [id, novoNome.trim()]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Paciente não encontrado' });
    }
    io.emit('queueUpdate');
    io.emit('acolhimentoUpdate');
    res.json({ message: 'Nome atualizado', patient: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/patients/:id/transfer — Transferir paciente para outro setor (requer senha admin)
app.put('/api/patients/:id/transfer', async (req, res) => {
  const client = await pool.connect();
  try {
    await garantirColunasEscuta(client);
    const { id } = req.params;
    const {
      novoSetor,
      novoTipoAtendimento,
      novoProfissional,
      observacao_segunda_escuta,
      is_intercorrencia_acolhimento,
      horario_marcado,
      senha
    } = req.body;

    if (!isValidAdminPass(senha)) {
      return res.status(403).json({ error: 'Senha administrativa incorreta' });
    }
    if (!novoSetor || !SETORES.includes(novoSetor)) {
      return res.status(400).json({ error: 'Setor de destino inválido' });
    }

    await client.query('BEGIN');

    // Busca o paciente atual antes de mover (para log de histórico)
    const pResult = await client.query('SELECT * FROM patients WHERE id = $1 FOR UPDATE', [id]);
    if (pResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Paciente não encontrado' });
    }
    const patientAntes = pResult.rows[0];
    if (patientAntes.status === 'atendido' || patientAntes.status === 'desistencia') {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Paciente já finalizado' });
    }

    const novoHorario = new Date().toLocaleTimeString('pt-BR', {
      timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'
    });
    const veioDoAcolhimento = patientAntes.setor === 'Acolhimento' || Boolean(is_intercorrencia_acolhimento);
    const isIntercFinal = veioDoAcolhimento ? true : Boolean(patientAntes.is_intercorrencia_acolhimento);
    const tipo = novoTipoAtendimento || (veioDoAcolhimento ? 'Intercorrência (Acolhimento)' : null);
    const prof = inferirProfissionalPorEquipe(novoSetor, patientAntes.equipe_paciente, novoProfissional);
    const motivo1Preservado = (patientAntes.motivo_primeira_escuta && String(patientAntes.motivo_primeira_escuta).trim())
      || (patientAntes.queixa && String(patientAntes.queixa).trim())
      || null;
    const obs2Preservada = (observacao_segunda_escuta && String(observacao_segunda_escuta).trim())
      ? String(observacao_segunda_escuta).trim()
      : (patientAntes.observacao_segunda_escuta || null);
    const novaEtapaFluxo = veioDoAcolhimento ? 'encaminhado_intercorrencia' : (patientAntes.etapa_fluxo || 'recepcao');
    const origemTransf = patientAntes.setor === 'Acolhimento' && patientAntes.etapa_fluxo === 'segunda_escuta'
      ? '2ª Escuta (Acolhimento)'
      : patientAntes.setor;

    // Preservar ou elevar prioridade do paciente ao transferir
    let prioInfo = preservarOuElevarPrioridade(patientAntes);
    let ordemOdontoTransfer = patientAntes.ordem_prioridade_odonto || null;
    const horarioMarcadoTransfer = horario_marcado !== undefined
      ? normalizarHorarioMarcado(horario_marcado)
      : (patientAntes.horario_marcado || null);
    if (novoSetor === 'Odontologia') {
      const calcOd = calcularOrdemPrioridadeOdonto(
        patientAntes.idade,
        prioInfo.prioridade,
        prioInfo.tipo_prioridade,
        patientAntes.condicoes_especiais
      );
      prioInfo = {
        prioridade: calcOd.prioridade,
        nivel_prioridade: calcOd.nivel,
        tipo_prioridade: calcOd.tipo_prioridade
      };
      ordemOdontoTransfer = calcOd.ordem_prioridade_odonto;
    }
    const novoSortOrder = null;

    const result = await client.query(
      `UPDATE patients
       SET setor = $2,
           setor_destino = $3,
           sort_order = $4,
           horario = $5,
           tipo_atendimento = $6,
           profissional = $7,
           profissional_destino = $8,
           origem_transferencia = $9,
           etapa_fluxo = $10,
           is_intercorrencia_acolhimento = $11,
           motivo_primeira_escuta = COALESCE($12::text, motivo_primeira_escuta),
           queixa = COALESCE($13::text, queixa),
           observacao_segunda_escuta = COALESCE($14::text, observacao_segunda_escuta),
           prioridade = $15,
           nivel_prioridade = $16,
           tipo_prioridade = COALESCE($17::text, tipo_prioridade),
           horario_marcado = $18,
           ordem_prioridade_odonto = $19,
           status = 'aguardando',
           created_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [
        id,
        novoSetor,
        novoSetor,
        novoSortOrder,
        novoHorario,
        tipo,
        prof,
        prof,
        origemTransf,
        novaEtapaFluxo,
        isIntercFinal,
        motivo1Preservado,
        motivo1Preservado,
        obs2Preservada,
        prioInfo.prioridade,
        prioInfo.nivel_prioridade,
        prioInfo.tipo_prioridade,
        horarioMarcadoTransfer,
        ordemOdontoTransfer
      ]
    );
    const patient = result.rows[0];

    // ===== EXCEÇÃO: Regulação ⇄ Farmácia entra na 3ª POSIÇÃO da fila de destino =====
    // (relacionada ao botão "Chamar 3 Próximos"). Só fixa a posição dos 2 primeiros e do encaminhado;
    // os demais pacientes mantêm exatamente a ordem relativa que já tinham.
    let posicaoAplicada = null;
    if (novoSetor === 'Odontologia') {
      await reordenarFilaOdontologia(client);
    } else if (isParRegulacaoFarmacia(patientAntes.setor, novoSetor)) {
      const filaDestino = await client.query(
        `SELECT id, sort_order FROM patients
         WHERE setor = $1 AND status = 'aguardando' AND id <> $2
         ORDER BY ${SQL_ORDEM_FILA}`,
        [novoSetor, patient.id]
      );
      const lista = filaDestino.rows.map(r => ({ id: r.id, sort_order: r.sort_order }));
      const insertIdx = Math.min(2, lista.length);
      lista.splice(insertIdx, 0, { id: patient.id, sort_order: null, encaminhado: true });
      for (let i = 0; i < lista.length; i++) {
        const item = lista[i];
        // Os itens até o encaminhado (inclusive) recebem posição fixa; depois dele, apenas quem já tinha
        // posição manual é renumerado (para não colidir), o restante continua dinâmico (NULL).
        if (i <= insertIdx || item.sort_order !== null) {
          await client.query(
            'UPDATE patients SET sort_order = $1 WHERE id = $2',
            [i + 1, item.id]
          );
        }
      }
      posicaoAplicada = insertIdx + 1;
      patient.sort_order = posicaoAplicada;
    } else if (prioInfo.prioridade === 'prioritario') {
      await fixarPrioritarioNoTopoDaFila(client, patient, { fixarPrimeiroDireto: false });
      posicaoAplicada = patient.sort_order || 1;
    }

    // Registrar no histórico de chamadas (log de transferência)
    const horarioLog = new Date().toLocaleTimeString('pt-BR', {
      timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'
    });

    await client.query('SAVEPOINT sp_transfer_hist');
    try {
      await client.query(
        `INSERT INTO call_history
           (patient_id, nome, setor, medico, horario_chamada, profissional, prioridade, tipo_prioridade,
            equipe_paciente, motivo_primeira_escuta, observacao_segunda_escuta, is_intercorrencia_acolhimento)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          patient.id,
          patient.nome,
          patientAntes.setor, // Origem
          prof || null,       // Se houver um profissional destino específico
          horarioLog,
          `➡️ Encaminhado p/ ${novoSetor}${prof ? ' (' + prof + ')' : ''}`, // Aparece na coluna Profissional no PDF
          patient.prioridade || 'geral',
          patient.tipo_prioridade || null,
          patient.equipe_paciente || null,
          motivo1Preservado,
          obs2Preservada,
          isIntercFinal
        ]
      );
    } catch (histErr) {
      await client.query('ROLLBACK TO SAVEPOINT sp_transfer_hist');
      console.warn('[transfer] Aviso ao gravar call_history:', histErr.message);
    }

    await client.query('COMMIT');
    await anexarBuscaAtivaDetalhes([patient], pool);
    io.emit('queueUpdate');
    io.emit('acolhimentoUpdate');
    res.json({
      message: posicaoAplicada
        ? `Paciente transferido para ${novoSetor} na ${posicaoAplicada}ª posição`
        : `Paciente transferido para ${novoSetor}`,
      patient,
      posicao_aplicada: posicaoAplicada
    });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// ====== FIM MELHORIA G ======

// Remove patient (desistência) – requires admin password
app.post('/api/remove-patient', async (req, res) => {
  try {
    const { id, senha } = req.body;
    
    if (!isValidAdminPass(senha)) {
      return res.status(403).json({ error: 'Senha administrativa incorreta' });
    }
    
    if (!id) {
      return res.status(400).json({ error: 'ID do paciente é obrigatório' });
    }
    
    const result = await pool.query(
      "UPDATE patients SET status = 'desistencia', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *",
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Paciente não encontrado' });
    }
    
    io.emit('queueUpdate');
    res.json({ message: 'Paciente removido com sucesso', patient: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get call history (today only)
app.get('/api/history', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM call_history
       WHERE DATE(created_at AT TIME ZONE 'America/Sao_Paulo') = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
       ORDER BY created_at AT TIME ZONE 'America/Sao_Paulo' DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get filtered history (for reports)
app.get('/api/history/filtered', async (req, res) => {
  try {
    const { data, setor, profissional } = req.query;
    let query = 'SELECT * FROM call_history WHERE 1=1';
    const params = [];
    let idx = 1;
    
    if (data) {
      query += ` AND DATE(created_at AT TIME ZONE 'America/Sao_Paulo') = $${idx}`;
      params.push(data);
      idx++;
    }
    
    if (setor) {
      query += ` AND setor = $${idx}`;
      params.push(setor);
      idx++;
    }
    
    if (profissional) {
      query += ` AND (profissional = $${idx} OR medico = $${idx})`;
      params.push(profissional);
      idx++;
    }
    
    query += " ORDER BY created_at AT TIME ZONE 'America/Sao_Paulo' DESC";
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get monthly report
app.get('/api/history/monthly', async (req, res) => {
  try {
    const { mes, ano } = req.query;
    const month = parseInt(mes) || new Date().getMonth() + 1;
    const year = parseInt(ano) || new Date().getFullYear();
    
    const result = await pool.query(
      `SELECT * FROM call_history
       WHERE EXTRACT(MONTH FROM created_at AT TIME ZONE 'America/Sao_Paulo') = $1
       AND EXTRACT(YEAR FROM created_at AT TIME ZONE 'America/Sao_Paulo') = $2
       ORDER BY created_at AT TIME ZONE 'America/Sao_Paulo' DESC`,
      [month, year]
    );
    
    const records = result.rows;
    const bySetor = {};
    const byProfissional = {};
    const byDay = {};
    
    records.forEach(r => {
      bySetor[r.setor] = (bySetor[r.setor] || 0) + 1;
      let prof = r.profissional || r.medico;
      if (!prof || prof === 'Não especificado') {
        if (r.setor && r.setor.toLowerCase().includes('regula')) prof = 'Vivi';
        else if (r.setor && r.setor.toLowerCase().includes('farm')) prof = 'Leandra';
        else prof = 'Não especificado';
      }
      byProfissional[prof] = (byProfissional[prof] || 0) + 1;
      const day = new Date(r.created_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      byDay[day] = (byDay[day] || 0) + 1;
    });
    
    res.json({ total: records.length, bySetor, byProfissional, byDay, records });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get attended patients list (today only)
app.get('/api/attended', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM call_history
       WHERE DATE(created_at AT TIME ZONE 'America/Sao_Paulo') = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
       ORDER BY created_at AT TIME ZONE 'America/Sao_Paulo' DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get current calling
app.get('/api/current-calling', async (req, res) => {
  try {
    const current = {};
    SETORES.forEach(s => current[s] = null);

    for (const setor of SETORES) {
      const result = await pool.query(
        `SELECT id, nome, setor, horario, status, medico, consultorio, profissional,
                prioridade, tipo_prioridade, tipo_atendimento, etapa_fluxo, created_at, updated_at
         FROM patients WHERE setor = $1 AND status = 'chamado'`,
        [setor]
      );
      if (result.rows.length > 0) current[setor] = result.rows[0];
    }

    // Contar atendidos HOJE
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM call_history
       WHERE DATE(created_at AT TIME ZONE 'America/Sao_Paulo') = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date`
    );
    const totalAtendidos = parseInt(countResult.rows[0].count, 10);

    // Contar desistências HOJE
    const desistResult = await pool.query(
      `SELECT COUNT(*) FROM patients
       WHERE status = 'desistencia'
       AND DATE(created_at AT TIME ZONE 'America/Sao_Paulo') = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date`
    );
    const totalDesistencias = parseInt(desistResult.rows[0].count, 10);

    res.json({ current, totalAtendidos, totalDesistencias });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ====== DASHBOARD METRICS ======
app.get('/api/dashboard/metrics', async (req, res) => {
  try {
    const { data } = req.query;
    const filterDate = data ? data : "(NOW() AT TIME ZONE 'America/Sao_Paulo')::date";
    const dateQuery = data ? `$1` : `${filterDate}`;
    const params = data ? [data] : [];
    const todayFilter = `DATE(created_at AT TIME ZONE 'America/Sao_Paulo') = ${dateQuery}`;
    
    // Attended today by sector
    const attendedResult = await pool.query(
      `SELECT COUNT(*) as total, setor FROM call_history WHERE DATE(created_at AT TIME ZONE 'America/Sao_Paulo') = ${dateQuery} GROUP BY setor`,
      params
    );
    
    // Desistencias today
    const desistResult = await pool.query(
      `SELECT COUNT(*) as total FROM patients WHERE status = 'desistencia' AND DATE(updated_at AT TIME ZONE 'America/Sao_Paulo') = ${dateQuery}`,
      params
    );
    
    // Currently waiting
    const waitingResult = await pool.query(
      `SELECT COUNT(*) as total, setor FROM patients WHERE status = 'aguardando' GROUP BY setor`
    );
    
    // Average wait time by sector
    const avgWaitResult = await pool.query(
      `SELECT ch.setor,
              AVG(EXTRACT(EPOCH FROM (ch.created_at - p.created_at)) / 60) as avg_minutes
       FROM call_history ch
       JOIN patients p ON ch.patient_id = p.id
       WHERE DATE(ch.created_at AT TIME ZONE 'America/Sao_Paulo') = ${dateQuery}
       GROUP BY ch.setor`,
      params
    );
    
    // Bottleneck (waiting > 30 min) – ensure comparisons use same domain
    const bottleneckResult = await pool.query(
      `SELECT COUNT(*) as total, setor FROM patients
       WHERE status = 'aguardando'
       AND created_at < (CASE WHEN $1::date = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date THEN NOW() AT TIME ZONE 'America/Sao_Paulo' ELSE ($1::date + INTERVAL '23 hours 59 minutes') END) - INTERVAL '30 minutes'
       GROUP BY setor`,
      [data || new Date().toISOString().split('T')[0]]
    );
    
    // Atendidos por turno (manhã < 12h, tarde >= 12h)
    const turnoManhaResult = await pool.query(
      `SELECT COUNT(*) as total FROM call_history
       WHERE DATE(created_at AT TIME ZONE 'America/Sao_Paulo') = ${dateQuery}
       AND EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo') < 12`,
      params
    );
    const turnoTardeResult = await pool.query(
      `SELECT COUNT(*) as total FROM call_history
       WHERE DATE(created_at AT TIME ZONE 'America/Sao_Paulo') = ${dateQuery}
       AND EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo') >= 12`,
      params
    );
    
    // Responsáveis de setores de apoio (Vivi -> Regulação, Leandra -> Farmácia)
    let responsaveisRows = [];
    try {
      const responsaveisResult = await pool.query(
        'SELECT nome, setor, cargo FROM responsaveis_setor WHERE ativo = true ORDER BY setor ASC, nome ASC'
      );
      if (responsaveisResult.rows.length === 0) {
        await pool.query(`
          INSERT INTO responsaveis_setor (nome, setor, cargo) VALUES
          ('Vivi', 'Regulação', 'Responsável pela Regulação'),
          ('Leandra', 'Farmácia', 'Responsável pela Farmácia')
          ON CONFLICT (nome, setor) DO NOTHING
        `);
        const recheck = await pool.query('SELECT nome, setor, cargo FROM responsaveis_setor WHERE ativo = true ORDER BY setor ASC, nome ASC');
        responsaveisRows = recheck.rows.length > 0 ? recheck.rows : [
          { nome: 'Vivi', setor: 'Regulação', cargo: 'Responsável pela Regulação' },
          { nome: 'Leandra', setor: 'Farmácia', cargo: 'Responsável pela Farmácia' }
        ];
      } else {
        responsaveisRows = responsaveisResult.rows;
      }
    } catch (e) {
      responsaveisRows = [
        { nome: 'Vivi', setor: 'Regulação', cargo: 'Responsável pela Regulação' },
        { nome: 'Leandra', setor: 'Farmácia', cargo: 'Responsável pela Farmácia' }
      ];
    }
    
    // Atendimentos por profissional no dia (com mapeamento automático de responsáveis)
    let porProfRows = [];
    try {
      // Corrigido: sem JOIN em responsaveis_setor para evitar multiplicação de linhas (COUNT duplo)
      const porProfResult = await pool.query(
        `SELECT 
           CASE 
             WHEN NULLIF(TRIM(COALESCE(c.profissional, c.medico, '')), '') IS NOT NULL 
                  AND TRIM(COALESCE(c.profissional, c.medico, '')) <> 'Não especificado'
               THEN TRIM(COALESCE(c.profissional, c.medico))
             WHEN c.setor ILIKE '%Regula%' THEN 'Vivi'
             WHEN c.setor ILIKE '%Farm%' THEN 'Leandra'
             ELSE 'Não especificado'
           END as profissional,
           c.setor,
           COUNT(*) as total
         FROM call_history c
         WHERE DATE(c.created_at AT TIME ZONE 'America/Sao_Paulo') = ${dateQuery}
         GROUP BY 
           CASE 
             WHEN NULLIF(TRIM(COALESCE(c.profissional, c.medico, '')), '') IS NOT NULL 
                  AND TRIM(COALESCE(c.profissional, c.medico, '')) <> 'Não especificado'
               THEN TRIM(COALESCE(c.profissional, c.medico))
             WHEN c.setor ILIKE '%Regula%' THEN 'Vivi'
             WHEN c.setor ILIKE '%Farm%' THEN 'Leandra'
             ELSE 'Não especificado'
           END,
           c.setor
         ORDER BY total DESC`,
        params
      );
      porProfRows = porProfResult.rows;
    } catch (e) {
      console.warn('Erro em porProf no metrics:', e.message);
    }

    const totalAttended = attendedResult.rows.reduce((sum, r) => sum + parseInt(r.total), 0);
    const totalDesist = parseInt(desistResult.rows[0]?.total || 0);
    const dropoutRate = totalAttended + totalDesist > 0
      ? ((totalDesist / (totalAttended + totalDesist)) * 100).toFixed(1)
      : '0.0';
    
    res.json({
      attendedBySetor: attendedResult.rows,
      totalAttended,
      totalDesist,
      dropoutRate,
      waitingBySetor: waitingResult.rows,
      avgWaitBySetor: avgWaitResult.rows,
      bottleneckBySetor: bottleneckResult.rows,
      attendedManha: parseInt(turnoManhaResult.rows[0]?.total || 0),
      attendedTarde: parseInt(turnoTardeResult.rows[0]?.total || 0),
      responsaveisSetor: responsaveisRows,
      porProfissional: porProfRows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Dashboard hourly data
app.get('/api/dashboard/hourly', async (req, res) => {
  try {
    const { data } = req.query;
    const dateQuery = data ? `$1` : `(NOW() AT TIME ZONE 'America/Sao_Paulo')::date`;
    const params = data ? [data] : [];
    
    const entriesResult = await pool.query(
      `SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo') as hour, COUNT(*) as total
       FROM patients WHERE DATE(created_at AT TIME ZONE 'America/Sao_Paulo') = ${dateQuery}
       GROUP BY hour
       ORDER BY hour`,
      params
    );
    
    const callsResult = await pool.query(
      `SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo') as hour, COUNT(*) as total
       FROM call_history WHERE DATE(created_at AT TIME ZONE 'America/Sao_Paulo') = ${dateQuery}
       GROUP BY hour
       ORDER BY hour`,
      params
    );
    
    const desistResult = await pool.query(
      `SELECT EXTRACT(HOUR FROM updated_at AT TIME ZONE 'America/Sao_Paulo') as hour, COUNT(*) as total
       FROM patients WHERE status = 'desistencia' AND DATE(updated_at AT TIME ZONE 'America/Sao_Paulo') = ${dateQuery}
       GROUP BY hour
       ORDER BY hour`,
      params
    );
    
    res.json({
      entries: entriesResult.rows,
      calls: callsResult.rows,
      desistencias: desistResult.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reset database (requires admin password) – full daily reset
app.post('/api/reset', async (req, res) => {
  try {
    const { senha } = req.body;
    
    if (!isValidAdminPass(senha)) {
      return res.status(403).json({ error: 'Senha administrativa incorreta' });
    }
    
    // Full daily reset: clear active queue, today's call history, and chat
    await pool.query('DELETE FROM patients');
    await pool.query(
      `DELETE FROM call_history
       WHERE DATE(created_at AT TIME ZONE 'America/Sao_Paulo') = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date`
    );
    await pool.query('DELETE FROM chat_messages');
    await pool.query('DELETE FROM chat_channels');
    await pool.query('DELETE FROM chat_leituras');
    // Limpar checklist interno do dia (ctrl_agendamentos)
    await pool.query(
      `DELETE FROM ctrl_agendamentos
       WHERE DATE(criado_em AT TIME ZONE 'America/Sao_Paulo') = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date`
    );
    await pool.query('ALTER SEQUENCE patients_id_seq RESTART WITH 1');
    await pool.query('ALTER SEQUENCE chat_messages_id_seq RESTART WITH 1');
    try { await pool.query('ALTER SEQUENCE chat_channels_id_seq RESTART WITH 1'); } catch(e) {}
    
    io.emit('queueUpdate');
    io.emit('chatReset');
    io.emit('chatChannelClear', { canal: '__all__' });
    
    res.json({ message: 'Fila diária resetada com sucesso! Tudo zerado.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ====== CHAT INTERNO (legacy – mantido para compatibilidade) ======
app.get('/api/chat', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM chat_messages ORDER BY created_at ASC LIMIT 200'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const { remetente, mensagem } = req.body;
    if (!remetente || !mensagem) {
      return res.status(400).json({ error: 'Remetente e mensagem são obrigatórios' });
    }
    const result = await pool.query(
      'INSERT INTO chat_messages (remetente, mensagem) VALUES ($1, $2) RETURNING *',
      [remetente, mensagem]
    );
    io.emit('chatMessage', result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ====== CHAT AVANÇADO COM CANAIS ======

// GET mensagens de um canal
app.get('/api/chat/canais/:canal', async (req, res) => {
  try {
    const { canal } = req.params;
    const result = await pool.query(
      `SELECT * FROM (
         SELECT * FROM chat_channels WHERE canal = $1 ORDER BY created_at DESC LIMIT 100
       ) sub ORDER BY created_at ASC`,
      [canal]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST mensagem em um canal
app.post('/api/chat/canais/:canal', async (req, res) => {
  try {
    const { canal } = req.params;
    const { autor, texto, urgente, anexo_nome, anexo_base64 } = req.body;
    if (!autor || (!texto && !anexo_base64)) {
      console.error(`❌ Chat error [${canal}]: Autor or texto/anexo missing`);
      return res.status(400).json({ error: 'Autor e texto/anexo são obrigatórios' });
    }
    
    // Limite de segurança no backend (~3MB de base64) para evitar estourar o limite da Vercel
    if (anexo_base64 && anexo_base64.length > 4000000) {
      return res.status(413).json({ error: 'Arquivo muito grande. O limite é de aproximadamente 2MB.' });
    }

    const result = await pool.query(
      'INSERT INTO chat_channels (canal, autor, texto, urgente, anexo_nome, anexo_base64) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [canal, autor, texto || '', urgente || false, anexo_nome || null, anexo_base64 || null]
    );
    const msg = result.rows[0];
    io.emit('chatChannelMessage', { canal, mensagem: msg });
    res.status(201).json(msg);
  } catch (error) {
    console.error(`❌ Chat DB Error [${canal}]:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST limpar canal (admin)
app.post('/api/chat/canais/:canal/clear', async (req, res) => {
  try {
    const { canal } = req.params;
    const { senha } = req.body;
    if (!isValidAdminPass(senha)) {
      return res.status(403).json({ error: 'Senha administrativa incorreta' });
    }
    await pool.query('DELETE FROM chat_channels WHERE canal = $1', [canal]);
    await pool.query('DELETE FROM chat_leituras WHERE canal = $1', [canal]);
    io.emit('chatChannelClear', { canal });
    res.json({ message: `Canal ${canal} limpo com sucesso` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST marcar como lido
app.post('/api/chat/read', async (req, res) => {
  try {
    const { canal, setor } = req.body;
    if (!canal || !setor) {
      return res.status(400).json({ error: 'Canal e setor são obrigatórios' });
    }
    // Get latest message id
    const latestResult = await pool.query(
      'SELECT COALESCE(MAX(id), 0) as max_id FROM chat_channels WHERE canal = $1',
      [canal]
    );
    const maxId = latestResult.rows[0].max_id;
    await pool.query(
      `INSERT INTO chat_leituras (canal, setor, last_read_id) VALUES ($1, $2, $3)
       ON CONFLICT (canal, setor) DO UPDATE SET last_read_id = $3`,
      [canal, setor, maxId]
    );
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET não lidas por setor
app.get('/api/chat/unread/:setor', async (req, res) => {
  try {
    const { setor } = req.params;
    const unread = {};
    for (const canal of CANAIS_CHAT) {
      // Total messages in canal
      const totalResult = await pool.query(
        'SELECT COALESCE(MAX(id), 0) as max_id FROM chat_channels WHERE canal = $1',
        [canal]
      );
      const maxId = totalResult.rows[0].max_id;
      // Last read by this setor
      const readResult = await pool.query(
        'SELECT last_read_id FROM chat_leituras WHERE canal = $1 AND setor = $2',
        [canal, setor]
      );
      const lastRead = readResult.rows.length > 0 ? readResult.rows[0].last_read_id : 0;
      // Count unread
      const countResult = await pool.query(
        'SELECT COUNT(*) as cnt FROM chat_channels WHERE canal = $1 AND id > $2',
        [canal, lastRead]
      );
      unread[canal] = parseInt(countResult.rows[0].cnt);
    }
    res.json(unread);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* === MELHORIA C: ROTAS DE PRESENÇA ONLINE === */

// POST registrar presença
app.post('/api/chat/presenca', async (req, res) => {
  try {
    const { setor } = req.body;
    if (!setor) return res.status(400).json({ error: 'Setor obrigatório' });
    await pool.query(
      `INSERT INTO chat_presenca (setor, last_seen) VALUES ($1, CURRENT_TIMESTAMP)
       ON CONFLICT (setor) DO UPDATE SET last_seen = CURRENT_TIMESTAMP`,
      [setor]
    );
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET listar presenças
app.get('/api/chat/presenca', async (req, res) => {
  try {
    const result = await pool.query('SELECT setor, last_seen FROM chat_presenca');
    const map = {};
    result.rows.forEach(r => { map[r.setor] = r.last_seen; });
    res.json(map);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* === MELHORIA C: ROTAS DE PIN === */

// GET pin de um canal
app.get('/api/chat/canais/:canal/pin', async (req, res) => {
  try {
    const { canal } = req.params;
    const result = await pool.query('SELECT * FROM chat_channel_pins WHERE canal = $1', [canal]);
    res.json(result.rows.length ? result.rows[0] : null);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST fixar mensagem
app.post('/api/chat/canais/:canal/pin', async (req, res) => {
  try {
    const { canal } = req.params;
    const { texto, autor } = req.body;
    if (!texto || !autor) return res.status(400).json({ error: 'Texto e autor obrigatórios' });
    await pool.query(
      `INSERT INTO chat_channel_pins (canal, texto, autor) VALUES ($1, $2, $3)
       ON CONFLICT (canal) DO UPDATE SET texto = $2, autor = $3, created_at = CURRENT_TIMESTAMP`,
      [canal, texto, autor]
    );
    io.emit('chatPinUpdate', { canal, pin: { texto, autor } });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE remover pin
app.delete('/api/chat/canais/:canal/pin', async (req, res) => {
  try {
    const { canal } = req.params;
    await pool.query('DELETE FROM chat_channel_pins WHERE canal = $1', [canal]);
    io.emit('chatPinUpdate', { canal, pin: null });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* === FIM MELHORIA C: ROTAS === */

/* === MELHORIA D: ROTAS DE NOTIFICAÇÕES POP-UP === */

// GET notificações ativas para um setor
app.get('/api/notificacoes/:setor', async (req, res) => {
  try {
    const { setor } = req.params;
    const result = await pool.query(
      `SELECT * FROM notificacoes WHERE setor = $1 AND dismissed = false
       ORDER BY created_at ASC`,
      [setor]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST criar notificação (uso interno)
app.post('/api/notificacoes', async (req, res) => {
  try {
    const { setor, titulo, mensagem, tipo, patient_id } = req.body;
    if (!setor || !titulo || !mensagem) {
      return res.status(400).json({ error: 'Setor, titulo e mensagem são obrigatórios' });
    }
    const result = await pool.query(
      `INSERT INTO notificacoes (setor, titulo, mensagem, tipo, patient_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [setor, titulo, mensagem, tipo || 'sistema', patient_id || null]
    );
    const notif = result.rows[0];
    io.emit('notificacaoNova', { setor, notificacao: notif });
    res.status(201).json(notif);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST dismiss notificação (sincroniza entre dispositivos)
app.post('/api/notificacoes/:id/dismiss', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE notificacoes SET dismissed = true WHERE id = $1', [id]);
    io.emit('notificacaoDismissed', { id: parseInt(id) });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* === FIM MELHORIA D: ROTAS === */

/* === MELHORIA E: CONFIRMAÇÃO DE PRESENÇA === */

// POST confirmar presença de paciente
app.post('/api/patients/:id/confirmar-presenca', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Atualizar paciente
    const result = await pool.query(
      `UPDATE patients SET presenca_confirmada = true, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING *`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Paciente não encontrado' });
    }
    
    const patient = result.rows[0];
    const setor = patient.setor;
    const profLabel = patient.profissional ? ` — ${patient.profissional}` : '';
    
    // Criar notificação para o setor do profissional
    const notifResult = await pool.query(
      `INSERT INTO notificacoes (setor, titulo, mensagem, tipo, patient_id)
       VALUES ($1, $2, $3, 'presenca', $4) RETURNING *`,
      [
        setor,
        '✅ Paciente Presente',
        `${patient.nome} confirmou presença na recepção${profLabel}`,
        patient.id
      ]
    );
    
    const notif = notifResult.rows[0];
    
    // Emitir eventos Socket.IO
    io.emit('queueUpdate');
    io.emit('notificacaoNova', { setor, notificacao: notif });
    
    res.json({ message: 'Presença confirmada', patient, notificacao: notif });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* === FIM MELHORIA E: CONFIRMAÇÃO DE PRESENÇA === */

// ====== CTRL AGENDAMENTOS (Checklist Interno – Sala de Agendamento) ======

// GET /api/ctrl-agendamentos — Lista do dia, pendentes no topo
app.get('/api/ctrl-agendamentos', async (req, res) => {
  try {
    // === MELHORIA 1: Filtro de data ===
    const { data } = req.query;
    let dateFilter;
    let params = [];
    if (data === 'todos') {
      dateFilter = '1=1';
    } else if (data) {
      dateFilter = `DATE(criado_em AT TIME ZONE 'America/Sao_Paulo') = $1`;
      params = [data];
    } else {
      dateFilter = `DATE(criado_em AT TIME ZONE 'America/Sao_Paulo') = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date`;
    }
    const result = await pool.query(
      `SELECT * FROM ctrl_agendamentos
       WHERE ${dateFilter}
       ORDER BY
         CASE WHEN status = 'pendente' THEN 0 ELSE 1 END ASC,
         criado_em ASC`,
      params
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/ctrl-agendamentos — Cria entrada (disparado pelo ACS ao finalizar com agendamento)
app.post('/api/ctrl-agendamentos', async (req, res) => {
  try {
    const { patient_id, nome, horario, queixa, equipe, cpf6 } = req.body;
    if (!nome || !horario) {
      return res.status(400).json({ error: 'Nome e horário são obrigatórios' });
    }
    const result = await pool.query(
      `INSERT INTO ctrl_agendamentos (patient_id, nome, horario, queixa, equipe, cpf6)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [patient_id || null, nome, horario, queixa || null, equipe || null, cpf6 || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/ctrl-agendamentos/:id/toggle — Alterna status pendente <-> agendado
app.patch('/api/ctrl-agendamentos/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;
    const { mes_agendamento, ano_agendamento } = req.body || {};
    // Busca status atual e inverte
    const current = await pool.query('SELECT status FROM ctrl_agendamentos WHERE id = $1', [id]);
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Registro não encontrado' });
    }
    const novoStatus = current.rows[0].status === 'pendente' ? 'agendado' : 'pendente';
    const result = await pool.query(
      `UPDATE ctrl_agendamentos
       SET status = $2,
           mes_agendamento = COALESCE($3, mes_agendamento),
           ano_agendamento = COALESCE($4, ano_agendamento),
           atualizado_em = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING *`,
      [id, novoStatus, mes_agendamento ? parseInt(mes_agendamento) : null, ano_agendamento ? parseInt(ano_agendamento) : null]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// DELETE /api/ctrl-agendamentos/:id — Remove o registro (Desistência)
app.delete('/api/ctrl-agendamentos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM ctrl_agendamentos WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Registro não encontrado' });
    }
    res.json({ success: true, message: 'Registro removido (Desistência)', deleted: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/ctrl-agendamentos/:id — Editar registro na Sala de Agendamento
app.put('/api/ctrl-agendamentos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, horario, queixa, equipe, cpf6, status, motivo, senha, mes_agendamento, ano_agendamento } = req.body;

    if (!isValidAdminPass(senha)) {
      return res.status(403).json({ error: 'Senha administrativa incorreta' });
    }
    if (!nome || !horario) {
      return res.status(400).json({ error: 'Nome e horário são obrigatórios' });
    }

    const result = await pool.query(
      `UPDATE ctrl_agendamentos
       SET nome = $1, horario = $2, queixa = $3, equipe = $4, cpf6 = $5,
           status = COALESCE($6, status), motivo = COALESCE($7, motivo),
           mes_agendamento = COALESCE($9, mes_agendamento),
           ano_agendamento = COALESCE($10, ano_agendamento),
           atualizado_em = CURRENT_TIMESTAMP
       WHERE id = $8 RETURNING *`,
      [
        nome, horario, queixa || null, equipe || null, cpf6 || null, status || null, motivo || null, id,
        mes_agendamento ? parseInt(mes_agendamento) : null,
        ano_agendamento ? parseInt(ano_agendamento) : null
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Registro não encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ====== FIM CTRL AGENDAMENTOS ======

// ====== ENCAMINHAMENTO PARA SALA DE AGENDAMENTO ======

// POST /api/patients/:id/encaminhar-agendamento — Encaminhar paciente da fila para a Sala de Agendamento
app.post('/api/patients/:id/encaminhar-agendamento', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { motivo, senha, mes_agendamento, ano_agendamento } = req.body;

    if (!isValidAdminPass(senha)) {
      return res.status(403).json({ error: 'Senha administrativa incorreta' });
    }
    if (!motivo) {
      return res.status(400).json({ error: 'O motivo do encaminhamento é obrigatório (Consulta ou Coleta de Sangue)' });
    }

    await client.query('BEGIN');

    // Buscar paciente atual
    const pResult = await client.query('SELECT * FROM patients WHERE id = $1', [id]);
    if (pResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Paciente não encontrado' });
    }
    const patient = pResult.rows[0];
    if (patient.status === 'atendido' || patient.status === 'desistencia') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Paciente já finalizado' });
    }

    const setorOrigem = patient.setor;

    // Regra de Negócio (Ajuste 2): Regulação e Farmácia só podem encaminhar "Fazer exame de coleta"
    if ((setorOrigem === 'Regulação' || setorOrigem === 'Farmácia') && motivo !== 'Fazer exame de coleta') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `⛔ Encaminhamento bloqueado: A ${setorOrigem} só permite encaminhar exames do tipo 'Fazer exame de coleta' para a Sala de Agendamento.`
      });
    }
    const horarioAtual = new Date().toLocaleTimeString('pt-BR', {
      timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'
    });

    const now = new Date();
    const targetMes = parseInt(mes_agendamento) || (now.getMonth() + 1);
    const targetAno = parseInt(ano_agendamento) || now.getFullYear();

    // 1. Criar registro na checklist da Sala de Agendamento com o mês/ano de destino
    await client.query(
      `INSERT INTO ctrl_agendamentos (patient_id, nome, horario, queixa, equipe, cpf6, setor_origem, motivo, mes_agendamento, ano_agendamento)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        patient.id,
        patient.nome,
        horarioAtual,
        patient.queixa || null,
        null, // equipe será preenchida pelo operador da Sala de Agendamento
        null, // cpf6 idem
        setorOrigem,
        motivo,
        targetMes,
        targetAno
      ]
    );

    // 2. Marcar paciente como atendido (saiu da fila do setor original)
    await client.query(
      `UPDATE patients SET status = 'atendido', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id]
    );

    // 3. Registrar no histórico de chamadas (log de transferência)
    await client.query(
      `INSERT INTO call_history
         (patient_id, nome, setor, horario_chamada, profissional, prioridade, tipo_prioridade)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        patient.id,
        patient.nome,
        setorOrigem,
        horarioAtual,
        `➡️ Enc. p/ Sala de Agendamento (${motivo})`,
        patient.prioridade || 'geral',
        patient.tipo_prioridade || null
      ]
    );

    await client.query('COMMIT');
    io.emit('queueUpdate');
    res.json({ message: `Paciente encaminhado para Sala de Agendamento (${motivo})`, patient });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// ====== FIM ENCAMINHAMENTO PARA SALA DE AGENDAMENTO ======

// GET /api/vagas-medicos/primeiro-disponivel — Varrer meses futuros e encontrar o primeiro com vagas restantes
app.get('/api/vagas-medicos/primeiro-disponivel', async (req, res) => {
  try {
    const now = new Date();
    let currentMonth = now.getMonth() + 1;
    let currentYear = now.getFullYear();

    for (let i = 0; i < 12; i++) {
      let m = currentMonth + i;
      let y = currentYear;
      while (m > 12) {
        m -= 12;
        y += 1;
      }

      const vagasResult = await pool.query(
        'SELECT * FROM vagas_medicos WHERE mes = $1 AND ano = $2',
        [m, y]
      );

      if (vagasResult.rows.length > 0) {
        const usadosResult = await pool.query(
          `SELECT 
             CASE 
               WHEN equipe IN ('Eq 1 Chico Mendes', 'Equipe 1 Chico Mendes', 'Chico Mendes') THEN 'Dr. Israel Christian'
               WHEN equipe IN ('Eq 2 Ximboré', 'Equipe 2 Ximboré', 'Equipe 2 Ximbore', 'Ximboré', 'Ximbore') THEN 'Dr. Joene Halan'
               WHEN equipe IN ('Eq 3 Aurora', 'Equipe 3 Aurora', 'Aurora') THEN 'Dra. Mirela Mota'
               ELSE equipe
             END AS medico, 
             COUNT(*) AS usados
           FROM ctrl_agendamentos
           WHERE status = 'agendado'
             AND COALESCE(mes_agendamento, EXTRACT(MONTH FROM criado_em AT TIME ZONE 'America/Sao_Paulo')) = $1
             AND COALESCE(ano_agendamento, EXTRACT(YEAR FROM criado_em AT TIME ZONE 'America/Sao_Paulo')) = $2
           GROUP BY 
             CASE 
               WHEN equipe IN ('Eq 1 Chico Mendes', 'Equipe 1 Chico Mendes', 'Chico Mendes') THEN 'Dr. Israel Christian'
               WHEN equipe IN ('Eq 2 Ximboré', 'Equipe 2 Ximboré', 'Equipe 2 Ximbore', 'Ximboré', 'Ximbore') THEN 'Dr. Joene Halan'
               WHEN equipe IN ('Eq 3 Aurora', 'Equipe 3 Aurora', 'Aurora') THEN 'Dra. Mirela Mota'
               ELSE equipe
             END`,
          [m, y]
        );

        const usadosMap = {};
        usadosResult.rows.forEach(r => { usadosMap[r.medico] = parseInt(r.usados); });

        const temVagas = vagasResult.rows.some(v => (v.vagas - (usadosMap[v.medico] || 0)) > 0);
        if (temVagas) {
          return res.json({ mes: m, ano: y, encontrado: true });
        }
      }
    }

    res.json({ mes: currentMonth, ano: currentYear, encontrado: false });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/vagas-medicos — Lista vagas e contagem de agendamentos do mês
app.get('/api/vagas-medicos', async (req, res) => {
  try {
    const now = new Date();
    const mes = parseInt(req.query.mes) || (now.getMonth() + 1);
    const ano = parseInt(req.query.ano) || now.getFullYear();

    // Buscar vagas cadastradas
    const vagasResult = await pool.query(
      'SELECT * FROM vagas_medicos WHERE mes = $1 AND ano = $2',
      [mes, ano]
    );

    // Contar agendamentos realizados (status = 'agendado') no mês para cada médico
    // Cruza com ctrl_agendamentos usando mes_agendamento/ano_agendamento (ou criado_em como fallback)
    const usadosResult = await pool.query(
      `SELECT 
         CASE 
           WHEN equipe IN ('Eq 1 Chico Mendes', 'Equipe 1 Chico Mendes', 'Chico Mendes') THEN 'Dr. Israel Christian'
           WHEN equipe IN ('Eq 2 Ximboré', 'Equipe 2 Ximboré', 'Equipe 2 Ximbore', 'Ximboré', 'Ximbore') THEN 'Dr. Joene Halan'
           WHEN equipe IN ('Eq 3 Aurora', 'Equipe 3 Aurora', 'Aurora') THEN 'Dra. Mirela Mota'
           ELSE equipe
         END AS medico, 
         COUNT(*) AS usados
       FROM ctrl_agendamentos
       WHERE status = 'agendado'
         AND COALESCE(mes_agendamento, EXTRACT(MONTH FROM criado_em AT TIME ZONE 'America/Sao_Paulo')) = $1
         AND COALESCE(ano_agendamento, EXTRACT(YEAR FROM criado_em AT TIME ZONE 'America/Sao_Paulo')) = $2
       GROUP BY 
         CASE 
           WHEN equipe IN ('Eq 1 Chico Mendes', 'Equipe 1 Chico Mendes', 'Chico Mendes') THEN 'Dr. Israel Christian'
           WHEN equipe IN ('Eq 2 Ximboré', 'Equipe 2 Ximboré', 'Equipe 2 Ximbore', 'Ximboré', 'Ximbore') THEN 'Dr. Joene Halan'
           WHEN equipe IN ('Eq 3 Aurora', 'Equipe 3 Aurora', 'Aurora') THEN 'Dra. Mirela Mota'
           ELSE equipe
         END`,
      [mes, ano]
    );

    const usadosMap = {};
    usadosResult.rows.forEach(r => { usadosMap[r.medico] = parseInt(r.usados); });

    const vagas = vagasResult.rows.map(v => ({
      ...v,
      usados: usadosMap[v.medico] || 0,
      restantes: v.vagas - (usadosMap[v.medico] || 0)
    }));

    res.json({ mes, ano, vagas });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/vagas-medicos — Criar/atualizar vagas de um médico
app.put('/api/vagas-medicos', async (req, res) => {
  try {
    const { medico, mes, ano, vagas } = req.body;
    if (!medico || !mes || !ano || vagas === undefined) {
      return res.status(400).json({ error: 'medico, mes, ano e vagas são obrigatórios' });
    }

    // Validação: não permitir mês/ano retroativo
    const now = new Date();
    const mesAtual = now.getMonth() + 1;
    const anoAtual = now.getFullYear();
    if (parseInt(ano) < anoAtual || (parseInt(ano) === anoAtual && parseInt(mes) < mesAtual)) {
      return res.status(400).json({ error: 'Não é permitido cadastrar vagas para meses anteriores ao atual.' });
    }

    const result = await pool.query(
      `INSERT INTO vagas_medicos (medico, mes, ano, vagas)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (medico, mes, ano) DO UPDATE SET vagas = $4
       RETURNING *`,
      [medico, mes, ano, parseInt(vagas)]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/vagas-medicos/:id — Excluir registro de vaga (permite refazer)
app.delete('/api/vagas-medicos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM vagas_medicos WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Registro de vaga não encontrado' });
    }
    res.json({ message: 'Vaga excluída com sucesso', deleted: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ====== FIM MELHORIA 3 ======

// ====== MELHORIA 4: CHAMADAS DE VOZ REMOTAS ======

// POST /api/voice-call — Registrar chamada de voz pendente
app.post('/api/voice-call', async (req, res) => {
  try {
    const { nome, setor, destino } = req.body;
    if (!nome) {
      return res.status(400).json({ error: 'Nome é obrigatório' });
    }
    const result = await pool.query(
      `INSERT INTO pending_voice_calls (nome, setor, destino)
       VALUES ($1, $2, $3) RETURNING *`,
      [nome, setor || 'Agendamento', destino || 'Sala de Agendamento']
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/voice-call/pending — Listar chamadas não processadas
app.get('/api/voice-call/pending', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM pending_voice_calls
       WHERE processed = false
       ORDER BY created_at ASC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/voice-call/:id/ack — Marcar chamada como processada
app.post('/api/voice-call/:id/ack', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      'UPDATE pending_voice_calls SET processed = true WHERE id = $1',
      [id]
    );
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ====== FIM MELHORIA 4 ======

// ====== VOZ NEURAL BRASILEIRA (TTS SERVER-SIDE COM CACHE + FALLBACK) ======
const crypto = require('crypto');
let googleTTS = null;
try { googleTTS = require('google-tts-api'); } catch (e) {}
let WebSocketLib = null;
try { WebSocketLib = require('ws'); } catch (e) {}

const TTS_CACHE = new Map();
const TTS_CACHE_MAX = 100;

function getEdgeVoiceProfile(vozKey) {
  const v = String(vozKey || 'feminina_br').toLowerCase().trim();
  if (v.includes('elza')) {
    return {
      key: 'elza_br',
      voiceName: 'pt-BR-FranciscaNeural',
      pitch: '-10%',
      rate: '-7%',
      label: 'Elza',
      gender: 'F',
      nativeAzureVoice: 'pt-BR-ElzaNeural'
    };
  }
  if (v.includes('brenda')) {
    return {
      key: 'brenda_br',
      voiceName: 'pt-BR-ThalitaMultilingualNeural',
      pitch: '+6%',
      rate: '+2%',
      label: 'Brenda',
      gender: 'F',
      nativeAzureVoice: 'pt-BR-BrendaNeural'
    };
  }
  if (v.includes('thalita') || v.includes('suave')) {
    return {
      key: 'thalita_br',
      voiceName: 'pt-BR-ThalitaMultilingualNeural',
      pitch: '+0Hz',
      rate: '-1%',
      label: 'Thalita',
      gender: 'F',
      nativeAzureVoice: 'pt-BR-ThalitaMultilingualNeural'
    };
  }
  if (v.includes('donato')) {
    return {
      key: 'donato_br',
      voiceName: 'pt-BR-AntonioNeural',
      pitch: '-14%',
      rate: '-6%',
      label: 'Donato',
      gender: 'M',
      nativeAzureVoice: 'pt-BR-DonatoNeural'
    };
  }
  if (v.includes('humberto')) {
    return {
      key: 'humberto_br',
      voiceName: 'pt-BR-AntonioNeural',
      pitch: '+6%',
      rate: '+2%',
      label: 'Humberto',
      gender: 'M',
      nativeAzureVoice: 'pt-BR-HumbertoNeural'
    };
  }
  if (v.includes('masc') || v.includes('antonio')) {
    return {
      key: 'masculina_br',
      voiceName: 'pt-BR-AntonioNeural',
      pitch: '+0Hz',
      rate: '-2%',
      label: 'Antônio',
      gender: 'M',
      nativeAzureVoice: 'pt-BR-AntonioNeural'
    };
  }
  return {
    key: 'feminina_br',
    voiceName: 'pt-BR-FranciscaNeural',
    pitch: '+0Hz',
    rate: '-2%',
    label: 'Francisca',
    gender: 'F',
    nativeAzureVoice: 'pt-BR-FranciscaNeural'
  };
}

function generateSecMsGecToken() {
  const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
  const WIN_EPOCH = 11644473600;
  let ticks = Math.floor(Date.now() / 1000) + WIN_EPOCH;
  ticks -= ticks % 300;
  const ticks100ns = BigInt(ticks) * 10000000n;
  const strToHash = `${ticks100ns.toString()}${TRUSTED_CLIENT_TOKEN}`;
  return crypto.createHash('sha256').update(strToHash, 'ascii').digest('hex').toUpperCase();
}

function escapeXmlText(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function synthesizeEdgeNeuralTTSOnce(texto, voiceProfile, timeoutMs = 5500) {
  const profile = typeof voiceProfile === 'string'
    ? { voiceName: voiceProfile, pitch: '+0Hz', rate: '-2%' }
    : (voiceProfile || { voiceName: 'pt-BR-FranciscaNeural', pitch: '+0Hz', rate: '-2%' });
  const voiceName = profile.voiceName || 'pt-BR-FranciscaNeural';
  const pitch = profile.pitch || '+0Hz';
  const rate = profile.rate || '-2%';

  return new Promise((resolve, reject) => {
    if (!WebSocketLib) return reject(new Error('ws module unavailable'));
    const connId = crypto.randomBytes(16).toString('hex');
    const reqId = crypto.randomBytes(16).toString('hex');
    const muid = crypto.randomBytes(16).toString('hex').toUpperCase();
    const secMsGec = generateSecMsGecToken();
    const CHROMIUM_FULL_VERSION = '143.0.3650.75';
    const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
    const wsUrl =
      `wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1` +
      `?Ocp-Apim-Subscription-Key=${TRUSTED_CLIENT_TOKEN}` +
      `&Sec-MS-GEC=${secMsGec}` +
      `&Sec-MS-GEC-Version=1-${CHROMIUM_FULL_VERSION}` +
      `&ConnectionId=${connId}`;

    const audioChunks = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { ws.close(); } catch (e) {}
        reject(new Error('Edge Neural TTS timeout'));
      }
    }, timeoutMs);

    let ws;
    try {
      ws = new WebSocketLib(wsUrl, {
        headers: {
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache',
          'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
          'Cookie': `muid=${muid};`
        }
      });
    } catch (err) {
      clearTimeout(timer);
      return reject(err);
    }

    ws.on('open', () => {
      const configMsg =
        `X-Timestamp:${new Date().toString()}\r\n` +
        `Content-Type:application/json; charset=utf-8\r\n` +
        `Path:speech.config\r\n\r\n` +
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' },
                outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
              }
            }
          }
        });
      ws.send(configMsg);

      const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='pt-BR'>` +
        `<voice name='${voiceName}'>` +
        `<prosody pitch='${pitch}' rate='${rate}' volume='+0%'>${escapeXmlText(texto)}</prosody>` +
        `</voice></speak>`;

      const ssmlMsg =
        `X-RequestId:${reqId}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${new Date().toString()}Z\r\n` +
        `Path:ssml\r\n\r\n` +
        ssml;
      ws.send(ssmlMsg);
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (buf.length < 2) return;
        const headerLen = buf.readUInt16BE(0);
        if (buf.length > 2 + headerLen) {
          const headerStr = buf.subarray(2, 2 + headerLen).toString('utf8');
          if (headerStr.includes('Path:audio')) {
            audioChunks.push(buf.subarray(2 + headerLen));
          }
        }
      } else {
        const str = data.toString('utf8');
        if (str.includes('Path:turn.end')) {
          clearTimeout(timer);
          if (!settled) {
            settled = true;
            try { ws.close(); } catch (e) {}
            const fullBuf = Buffer.concat(audioChunks);
            if (fullBuf.length > 100) {
              resolve(fullBuf.toString('base64'));
            } else {
              reject(new Error('Edge TTS returned empty audio'));
            }
          }
        }
      }
    });

    ws.on('unexpected-response', (req, res) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        try { ws.close(); } catch (e) {}
        reject(new Error(`Edge TTS HTTP ${res.statusCode}`));
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    ws.on('close', () => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        const fullBuf = Buffer.concat(audioChunks);
        if (fullBuf.length > 100) {
          resolve(fullBuf.toString('base64'));
        } else {
          reject(new Error('Edge TTS closed before turn.end'));
        }
      }
    });
  });
}

async function synthesizeEdgeNeuralTTS(texto, voiceProfile) {
  try {
    return await synthesizeEdgeNeuralTTSOnce(texto, voiceProfile, 5500);
  } catch (firstErr) {
    // Segunda tentativa imediata em caso de oscilação de rede
    return await synthesizeEdgeNeuralTTSOnce(texto, voiceProfile, 5500);
  }
}

async function synthesizeGooglePtBrTTS(texto) {
  if (!googleTTS) throw new Error('google-tts-api não disponível');
  const results = await googleTTS.getAllAudioBase64(texto, {
    lang: 'pt-BR',
    slow: false,
    host: 'https://translate.google.com',
    timeout: 6000,
    splitPunct: ',.?!;:'
  });
  const buffers = results.map(item => Buffer.from(item.base64, 'base64'));
  const combined = Buffer.concat(buffers);
  if (!combined.length) throw new Error('Google TTS retornou áudio vazio');
  return combined.toString('base64');
}

async function handleTtsRequest(req, res) {
  try {
    const rawTexto = (req.body && req.body.texto) || (req.query && req.query.texto) || '';
    const voz = (req.body && req.body.voz) || (req.query && req.query.voz) || 'feminina_br';
    const texto = String(rawTexto).trim().slice(0, 500);
    if (!texto) {
      return res.status(400).json({ error: 'Texto é obrigatório para síntese de voz' });
    }

    const cacheKey = `${voz}::${texto}`;
    if (TTS_CACHE.has(cacheKey)) {
      return res.json(TTS_CACHE.get(cacheKey));
    }

    const voiceProfile = getEdgeVoiceProfile(voz);
    const edgeVoice = voiceProfile.voiceName;
    let audioBase64 = null;
    let provider = 'edge-neural';

    try {
      audioBase64 = await synthesizeEdgeNeuralTTS(texto, voiceProfile);
    } catch (edgeErr) {
      // Fallback imediato para Google TTS Português do Brasil (natural pt-BR)
      provider = 'google-pt-br';
      audioBase64 = await synthesizeGooglePtBrTTS(texto);
    }

    const payload = {
      audioBase64,
      provider,
      voz,
      edgeVoice,
      voiceLabel: voiceProfile.label,
      gender: voiceProfile.gender
    };

    // Só armazena no cache quando vier da voz Neural (evita cachear fallback)
    if (provider === 'edge-neural') {
      if (TTS_CACHE.size >= TTS_CACHE_MAX) {
        const firstKey = TTS_CACHE.keys().next().value;
        if (firstKey) TTS_CACHE.delete(firstKey);
      }
      TTS_CACHE.set(cacheKey, payload);
    }

    res.json(payload);
  } catch (error) {
    console.warn('[TTS] Falha ao sintetizar no servidor:', error.message);
    res.status(502).json({ error: error.message });
  }
}

app.post('/api/tts', handleTtsRequest);
app.get('/api/tts', handleTtsRequest);
// ====== FIM VOZ NEURAL BRASILEIRA ======

// ====== AGENDAMENTOS ======

// GET - Estatísticas de Coletas de Sangue
app.get('/api/agendamentos/coletas/stats', async (req, res) => {
  try {
    const { data } = req.query;
    if (!data) return res.status(400).json({ error: 'Data é obrigatória' });
    const result = await pool.query(
      "SELECT status, COUNT(*) as count FROM agendamentos WHERE tipo_atendimento = 'Coleta de Sangue' AND data_agendamento = $1 GROUP BY status",
      [data]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET - Dashboard semanal de Coletas de Sangue (agendado vs realizado)
app.get('/api/dashboard/coletas-semanal', async (req, res) => {
  try {
    const { semanas } = req.query;
    const numSemanas = parseInt(semanas) || 4;
    
    // Buscar dados diários de coletas das últimas N semanas
    const result = await pool.query(
      `SELECT 
         data_agendamento,
         COUNT(*) as agendados,
         COUNT(*) FILTER (WHERE status IN ('confirmado', 'realizado', 'lembrete_enviado')) as realizados,
         COUNT(*) FILTER (WHERE status = 'faltou') as faltas,
         COUNT(*) FILTER (WHERE status = 'pendente') as pendentes,
         COUNT(*) FILTER (WHERE status = 'cancelado') as cancelados
       FROM agendamentos 
       WHERE tipo_atendimento = 'Coleta de Sangue'
         AND data_agendamento >= (CURRENT_DATE - ($1 * 7 || ' days')::interval)
         AND data_agendamento <= CURRENT_DATE
       GROUP BY data_agendamento
       ORDER BY data_agendamento ASC`,
      [numSemanas]
    );
    
    // Agrupar por semana
    const semanaMap = {};
    result.rows.forEach(row => {
      const date = new Date(row.data_agendamento);
      // Calcular o início da semana (segunda-feira)
      const dayOfWeek = date.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(date);
      monday.setDate(date.getDate() + mondayOffset);
      const weekKey = monday.toISOString().split('T')[0];
      
      if (!semanaMap[weekKey]) {
        semanaMap[weekKey] = { 
          inicio: weekKey, 
          dias: [],
          totalAgendados: 0, 
          totalRealizados: 0, 
          totalFaltas: 0,
          totalPendentes: 0,
          totalCancelados: 0
        };
      }
      
      const dia = {
        data: row.data_agendamento,
        agendados: parseInt(row.agendados),
        realizados: parseInt(row.realizados),
        faltas: parseInt(row.faltas),
        pendentes: parseInt(row.pendentes),
        cancelados: parseInt(row.cancelados)
      };
      semanaMap[weekKey].dias.push(dia);
      semanaMap[weekKey].totalAgendados += dia.agendados;
      semanaMap[weekKey].totalRealizados += dia.realizados;
      semanaMap[weekKey].totalFaltas += dia.faltas;
      semanaMap[weekKey].totalPendentes += dia.pendentes;
      semanaMap[weekKey].totalCancelados += dia.cancelados;
    });
    
    res.json({
      metaDiaria: 12,
      metaSemanal: 36,
      diasColetaPorSemana: 3,
      semanas: Object.values(semanaMap)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET - Dashboard de Coletas para controle manual (entrada manual de dados)
app.get('/api/dashboard/coletas-manual', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM coletas_controle ORDER BY data_coleta ASC`
    );
    res.json(result.rows);
  } catch (error) {
    // Tabela pode não existir ainda
    res.json([]);
  }
});

// POST - Salvar registro manual de coleta
app.post('/api/dashboard/coletas-manual', async (req, res) => {
  try {
    // Criar tabela se não existir
    await pool.query(`
      CREATE TABLE IF NOT EXISTS coletas_controle (
        id SERIAL PRIMARY KEY,
        data_coleta DATE NOT NULL,
        agendados INTEGER NOT NULL DEFAULT 0,
        realizados INTEGER NOT NULL DEFAULT 0,
        faltas INTEGER NOT NULL DEFAULT 0,
        observacoes TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(data_coleta)
      )
    `);
    
    const { data_coleta, agendados, realizados, faltas, observacoes } = req.body;
    if (!data_coleta) return res.status(400).json({ error: 'Data é obrigatória' });
    
    const result = await pool.query(
      `INSERT INTO coletas_controle (data_coleta, agendados, realizados, faltas, observacoes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (data_coleta) 
       DO UPDATE SET agendados = $2, realizados = $3, faltas = $4, observacoes = $5, created_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [data_coleta, agendados || 0, realizados || 0, faltas || 0, observacoes || null]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE - Remover registro manual de coleta
app.delete('/api/dashboard/coletas-manual/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM coletas_controle WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET – listar agendamentos com filtros
app.get('/api/agendamentos', async (req, res) => {
  try {
    const { data, profissional, status: statusFilter } = req.query;
    let query = 'SELECT * FROM agendamentos WHERE 1=1';
    const params = [];
    let idx = 1;

    if (data) {
      query += ` AND data_agendamento = $${idx}`;
      params.push(data);
      idx++;
    }
    if (profissional) {
      query += ` AND profissional = $${idx}`;
      params.push(profissional);
      idx++;
    }
    if (statusFilter) {
      query += ` AND status = $${idx}`;
      params.push(statusFilter);
      idx++;
    }

    query += ' ORDER BY data_agendamento ASC, horario ASC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST – criar agendamento
app.post('/api/agendamentos', async (req, res) => {
  try {
    const { nome, telefone, data_agendamento, horario, profissional, tipo_atendimento, template, observacoes, checklist_exames, equipe } = req.body;
    if (!nome || !telefone || !data_agendamento || !horario) {
      return res.status(400).json({ error: 'Nome, telefone, data e horário são obrigatórios' });
    }
    const result = await pool.query(
      `INSERT INTO agendamentos (nome, telefone, data_agendamento, horario, profissional, tipo_atendimento, template, observacoes, checklist_exames, equipe)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [nome, telefone, data_agendamento, horario, profissional || null, tipo_atendimento || null, template || 'lembrete', observacoes || null, checklist_exames || null, equipe || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT – atualizar status
app.put('/api/agendamentos/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'Status é obrigatório' });
    }
    const result = await pool.query(
      'UPDATE agendamentos SET status = $2 WHERE id = $1 RETURNING *',
      [id, status]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Agendamento não encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT - Editar Contato (nome e telefone) do Agendamento
app.put('/api/agendamentos/:id/edit', async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, telefone } = req.body;
    if (!nome || !telefone) {
      return res.status(400).json({ error: 'Nome e telefone são obrigatórios' });
    }
    const result = await pool.query(
      'UPDATE agendamentos SET nome = $1, telefone = $2 WHERE id = $3 RETURNING *',
      [nome, telefone, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Agendamento não encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT - Editar Envio (Cancelar ou Reagendar individualmente)
app.put('/api/agendamentos/:id/editar-envio', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, motivo, nova_data, novo_horario, setor } = req.body;
    if (!['cancelado', 'reagendado'].includes(status)) {
      return res.status(400).json({ error: 'Status deve ser cancelado ou reagendado' });
    }
    if (status === 'reagendado' && (!nova_data || !novo_horario)) {
      return res.status(400).json({ error: 'Nova data e novo horário são obrigatórios para reagendamento' });
    }

    const atualRes = await pool.query('SELECT * FROM agendamentos WHERE id = $1', [id]);
    if (atualRes.rows.length === 0) {
      return res.status(404).json({ error: 'Agendamento não encontrado' });
    }
    const agendAtual = atualRes.rows[0];

    // Validação de regra: nova data maior que a original
    const dataRefOriginal = agendAtual.data_original || agendAtual.data_agendamento;
    const dataOrigStr = dataRefOriginal ? new Date(dataRefOriginal).toISOString().split('T')[0] : '';
    if (status === 'reagendado' && nova_data <= dataOrigStr) {
      return res.status(400).json({ error: 'A nova data deve ser posterior à data original da consulta.' });
    }

    // Identificação do dispositivo e usuário
    const deviceId = getDeviceId(req);
    let deviceNome = 'Sem nome';
    if (deviceId) {
      const dRes = await pool.query('SELECT nome FROM dispositivos WHERE id = $1', [deviceId]);
      if (dRes.rows.length > 0 && dRes.rows[0].nome) {
        deviceNome = dRes.rows[0].nome;
      }
    }
    const usuarioStr = `${deviceNome}${setor ? ' (' + setor + ')' : ''}`;

    let query = '';
    let params = [];
    if (status === 'cancelado') {
      query = `UPDATE agendamentos 
               SET status = 'cancelado',
                   motivo_cancelamento = $2,
                   cancelado_em = CURRENT_TIMESTAMP,
                   cancelado_por = $3
               WHERE id = $1 
               RETURNING *`;
      params = [id, motivo || null, deviceNome];
    } else {
      const dataOrig = agendAtual.data_original || agendAtual.data_agendamento;
      const horaOrig = agendAtual.horario_original || agendAtual.horario;
      query = `UPDATE agendamentos 
               SET status = 'reagendado',
                   data_original = $2,
                   horario_original = $3,
                   data_agendamento = $4,
                   horario = $5,
                   motivo_cancelamento = $6,
                   reagendado_em = CURRENT_TIMESTAMP,
                   cancelado_por = $7
               WHERE id = $1 
               RETURNING *`;
      params = [id, dataOrig, horaOrig, nova_data, novo_horario, motivo || null, deviceNome];
    }

    const result = await pool.query(query, params);
    const atualizado = result.rows[0];

    // Registrar no histórico com dispositivo e usuário
    const histRes = await pool.query(
      `INSERT INTO agendamento_historico 
       (agendamento_id, paciente, telefone, tipo_atendimento, profissional, status_anterior, novo_status, motivo, data_anterior, horario_anterior, nova_data, novo_horario, em_lote, dispositivo_id, usuario)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, false, $13, $14)
       RETURNING id`,
      [
        agendAtual.id,
        agendAtual.nome,
        agendAtual.telefone,
        agendAtual.tipo_atendimento,
        agendAtual.profissional,
        agendAtual.status,
        status,
        motivo || null,
        agendAtual.data_agendamento,
        agendAtual.horario,
        status === 'reagendado' ? nova_data : null,
        status === 'reagendado' ? novo_horario : null,
        deviceId,
        usuarioStr
      ]
    );

    atualizado.snapshot_anterior = [{
      id: agendAtual.id,
      nome: agendAtual.nome,
      status: agendAtual.status,
      data_agendamento: agendAtual.data_agendamento,
      horario: agendAtual.horario,
      data_original: agendAtual.data_original,
      horario_original: agendAtual.horario_original,
      motivo_cancelamento: agendAtual.motivo_cancelamento,
      cancelado_em: agendAtual.cancelado_em,
      reagendado_em: agendAtual.reagendado_em,
      cancelado_por: agendAtual.cancelado_por
    }];
    atualizado.historico_ids = histRes.rows.map(r => r.id);

    res.json(atualizado);
  } catch (error) {
    console.error('Erro ao editar envio:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT - Editar Envio em Lote (por Categoria e Data)
app.put('/api/agendamentos/batch-editar-envio', async (req, res) => {
  try {
    const { tipo_atendimento, data, status, motivo, nova_data, novo_horario, setor } = req.body;
    if (!tipo_atendimento || !data || !status) {
      return res.status(400).json({ error: 'tipo_atendimento, data e status são obrigatórios' });
    }
    if (!['cancelado', 'reagendado'].includes(status)) {
      return res.status(400).json({ error: 'Status deve ser cancelado ou reagendado' });
    }
    if (status === 'reagendado' && (!nova_data || !novo_horario)) {
      return res.status(400).json({ error: 'Nova data e novo horário são obrigatórios para reagendamento' });
    }
    if (status === 'reagendado' && nova_data <= data) {
      return res.status(400).json({ error: 'A nova data deve ser posterior à data original da consulta.' });
    }

    // Identificação do dispositivo e usuário
    const deviceId = getDeviceId(req);
    let deviceNome = 'Sem nome';
    if (deviceId) {
      const dRes = await pool.query('SELECT nome FROM dispositivos WHERE id = $1', [deviceId]);
      if (dRes.rows.length > 0 && dRes.rows[0].nome) {
        deviceNome = dRes.rows[0].nome;
      }
    }
    const usuarioStr = `${deviceNome}${setor ? ' (' + setor + ')' : ''}`;

    // Busca agendamentos da categoria e data que não estejam cancelados
    const buscaRes = await pool.query(
      `SELECT * FROM agendamentos 
       WHERE tipo_atendimento = $1 AND data_agendamento = $2 AND status != 'cancelado'
       ORDER BY horario ASC`,
      [tipo_atendimento, data]
    );

    const alvos = buscaRes.rows;
    if (alvos.length === 0) {
      return res.status(404).json({ error: 'Nenhum agendamento encontrado para a categoria e data fornecidas' });
    }

    const snapshotAnterior = alvos.map(a => ({
      id: a.id,
      nome: a.nome,
      status: a.status,
      data_agendamento: a.data_agendamento,
      horario: a.horario,
      data_original: a.data_original,
      horario_original: a.horario_original,
      motivo_cancelamento: a.motivo_cancelamento,
      cancelado_em: a.cancelado_em,
      reagendado_em: a.reagendado_em,
      cancelado_por: a.cancelado_por
    }));
    const historicoIds = [];
    const editados = [];

    for (const agendAtual of alvos) {
      let query = '';
      let params = [];
      if (status === 'cancelado') {
        query = `UPDATE agendamentos 
                 SET status = 'cancelado',
                     motivo_cancelamento = $2,
                     cancelado_em = CURRENT_TIMESTAMP,
                     cancelado_por = $3
                 WHERE id = $1 
                 RETURNING *`;
        params = [agendAtual.id, motivo || null, deviceNome];
      } else {
        const dataOrig = agendAtual.data_original || agendAtual.data_agendamento;
        const horaOrig = agendAtual.horario_original || agendAtual.horario;
        query = `UPDATE agendamentos 
                 SET status = 'reagendado',
                     data_original = $2,
                     horario_original = $3,
                     data_agendamento = $4,
                     horario = $5,
                     motivo_cancelamento = $6,
                     reagendado_em = CURRENT_TIMESTAMP,
                     cancelado_por = $7
                 WHERE id = $1 
                 RETURNING *`;
        params = [agendAtual.id, dataOrig, horaOrig, nova_data, novo_horario, motivo || null, deviceNome];
      }

      const r = await pool.query(query, params);
      editados.push(r.rows[0]);

      const histRow = await pool.query(
        `INSERT INTO agendamento_historico 
         (agendamento_id, paciente, telefone, tipo_atendimento, profissional, status_anterior, novo_status, motivo, data_anterior, horario_anterior, nova_data, novo_horario, em_lote, dispositivo_id, usuario)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, $13, $14)
         RETURNING id`,
        [
          agendAtual.id,
          agendAtual.nome,
          agendAtual.telefone,
          agendAtual.tipo_atendimento,
          agendAtual.profissional,
          agendAtual.status,
          status,
          motivo || null,
          agendAtual.data_agendamento,
          agendAtual.horario,
          status === 'reagendado' ? nova_data : null,
          status === 'reagendado' ? novo_horario : null,
          deviceId,
          usuarioStr
        ]
      );
      if (histRow.rows[0]?.id) historicoIds.push(histRow.rows[0].id);
    }

    res.json({
      total: editados.length,
      agendamentos: editados,
      snapshot_anterior: snapshotAnterior,
      historico_ids: historicoIds
    });
  } catch (error) {
    console.error('Erro em lote editar envio:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST - Reverter / Desfazer alteração em lote (ou individual) de agendamentos
app.post('/api/agendamentos/reverter-lote', async (req, res) => {
  const client = await pool.connect();
  try {
    const { snapshot_anterior, historico_ids } = req.body || {};
    if (!Array.isArray(snapshot_anterior) || snapshot_anterior.length === 0) {
      return res.status(400).json({ error: 'Nenhum dado de agendamento anterior para reverter.' });
    }

    await client.query('BEGIN');

    let revertidos = 0;
    for (const snap of snapshot_anterior) {
      if (!snap || !snap.id) continue;
      const r = await client.query(
        `UPDATE agendamentos
         SET status = $2,
             data_agendamento = $3,
             horario = $4,
             data_original = $5,
             horario_original = $6,
             motivo_cancelamento = $7,
             cancelado_em = $8,
             reagendado_em = $9,
             cancelado_por = $10
         WHERE id = $1
         RETURNING id`,
        [
          snap.id,
          snap.status || 'pendente',
          snap.data_agendamento,
          snap.horario,
          snap.data_original || null,
          snap.horario_original || null,
          snap.motivo_cancelamento || null,
          snap.cancelado_em || null,
          snap.reagendado_em || null,
          snap.cancelado_por || null
        ]
      );
      if (r.rowCount > 0) revertidos++;
    }

    if (Array.isArray(historico_ids) && historico_ids.length > 0) {
      const idsValidos = historico_ids.map(Number).filter(n => Number.isInteger(n) && n > 0);
      if (idsValidos.length > 0) {
        await client.query(
          `DELETE FROM agendamento_historico WHERE id = ANY($1::int[])`,
          [idsValidos]
        );
      }
    }

    await client.query('COMMIT');
    res.json({
      message: `${revertidos} agendamento(s) restaurado(s) ao estado original com sucesso!`,
      revertidos
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao reverter lote de agendamentos:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// DELETE – excluir agendamento via painel de lembretes D-1 (sem senha, com confirmação no front)
app.delete('/api/agendamentos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM agendamentos WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Agendamento não encontrado' });
    }
    res.json({ message: 'Agendamento excluído', agendamento: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE – excluir agendamento (admin)
app.post('/api/agendamentos/:id/delete', async (req, res) => {
  try {
    const { id } = req.params;
    const { senha } = req.body;
    if (!isValidAdminPass(senha)) {
      return res.status(403).json({ error: 'Senha administrativa incorreta' });
    }
    const result = await pool.query('DELETE FROM agendamentos WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Agendamento não encontrado' });
    }
    res.json({ message: 'Agendamento excluído', agendamento: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE – excluir paciente permanentemente (admin)
app.post('/api/patients/:id/delete', async (req, res) => {
  try {
    const { id } = req.params;
    const { senha } = req.body;
    if (!isValidAdminPass(senha)) {
      return res.status(403).json({ error: 'Senha administrativa incorreta' });
    }
    const result = await pool.query('DELETE FROM patients WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Paciente não encontrado' });
    }
    io.emit('queueUpdate');
    res.json({ message: 'Paciente excluído do banco', patient: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE – excluir do histórico de chamadas (admin)
app.post('/api/history/:id/delete', async (req, res) => {
  try {
    const { id } = req.params;
    const { senha } = req.body;
    if (!isValidAdminPass(senha)) {
      return res.status(403).json({ error: 'Senha administrativa incorreta' });
    }
    const result = await pool.query('DELETE FROM call_history WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Registro não encontrado' });
    }
    io.emit('queueUpdate');
    res.json({ message: 'Registro excluído do histórico', record: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ====== ACOLHIMENTO WORKFLOW ======

// GET fluxo – pacientes do Acolhimento agrupados por etapa
app.get('/api/acolhimento/fluxo', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT *,
              ROUND(EXTRACT(EPOCH FROM (NOW() - created_at)) / 60.0, 1) AS espera_minutos
       FROM patients
       WHERE setor = 'Acolhimento' AND status NOT IN ('atendido', 'desistencia')
       ORDER BY
         CASE WHEN risco_clinico = 'vermelho' THEN 0 WHEN risco_clinico = 'amarelo' THEN 1 WHEN risco_clinico = 'verde' THEN 2 WHEN risco_clinico = 'azul' THEN 3 ELSE 2 END ASC,
         COALESCE(nivel_prioridade, 3) ASC,
         CASE WHEN prioridade = 'prioritario' THEN 0 ELSE 1 END ASC,
         created_at AT TIME ZONE 'America/Sao_Paulo' ASC`
    );
    await anexarBuscaAtivaDetalhes(result.rows, pool);
    const grouped = { recepcao: [], primeira_escuta: [], segunda_escuta: [] };
    result.rows.forEach(p => {
      const etapa = p.etapa_fluxo || 'recepcao';
      if (grouped[etapa]) grouped[etapa].push(p);
    });
    res.json(grouped);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET relatório do acolhimento
app.get('/api/acolhimento/relatorio', async (req, res) => {
  try {
    // Finalizados hoje
    const finalizados = await pool.query(
      `SELECT * FROM call_history
       WHERE setor = 'Acolhimento'
       AND DATE(created_at AT TIME ZONE 'America/Sao_Paulo') = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
       ORDER BY created_at AT TIME ZONE 'America/Sao_Paulo' DESC`
    );
    // Ativos agora
    const ativos = await pool.query(
      `SELECT etapa_fluxo, risco_clinico, COUNT(*) as total
       FROM patients
       WHERE setor = 'Acolhimento' AND status NOT IN ('atendido', 'desistencia')
       GROUP BY etapa_fluxo, risco_clinico`
    );
    // Por ACS
    const porAcs = await pool.query(
      `SELECT acs_responsavel, COUNT(*) as total
       FROM patients
       WHERE setor = 'Acolhimento' AND acs_responsavel IS NOT NULL
       AND DATE(created_at AT TIME ZONE 'America/Sao_Paulo') = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
       GROUP BY acs_responsavel`
    );
    // Por profissional destino
    const porProf = await pool.query(
      `SELECT profissional_destino, tipo_profissional_destino, COUNT(*) as total
       FROM patients
       WHERE setor = 'Acolhimento' AND profissional_destino IS NOT NULL
       AND DATE(created_at AT TIME ZONE 'America/Sao_Paulo') = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
       GROUP BY profissional_destino, tipo_profissional_destino`
    );
    // Tempo médio por etapa
    const tempoMedio = await pool.query(
      `SELECT
         AVG(CASE WHEN etapa_fluxo != 'recepcao' THEN EXTRACT(EPOCH FROM (updated_at - created_at))/60 END) as avg_recepcao_min,
         AVG(CASE WHEN etapa_fluxo = 'segunda_escuta' OR etapa_fluxo = 'finalizado' THEN EXTRACT(EPOCH FROM (updated_at - inicio_etapa))/60 END) as avg_escuta_min
       FROM patients
       WHERE setor = 'Acolhimento'
       AND DATE(created_at AT TIME ZONE 'America/Sao_Paulo') = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date`
    );
    // Risco por cor (include all non-green/non-null)
    const riscoCor = await pool.query(
      `SELECT risco_clinico, COUNT(*) as total
       FROM patients
       WHERE setor = 'Acolhimento' AND risco_clinico IS NOT NULL
       AND DATE(created_at AT TIME ZONE 'America/Sao_Paulo') = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
       GROUP BY risco_clinico`
    );
    res.json({
      finalizados: finalizados.rows,
      totalFinalizados: finalizados.rows.length,
      ativos: ativos.rows,
      porAcs: porAcs.rows,
      porProf: porProf.rows,
      tempoMedio: tempoMedio.rows[0] || {},
      riscoCor: riscoCor.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT iniciar escuta – recepcao -> primeira_escuta
app.put('/api/acolhimento/:id/iniciar-escuta', async (req, res) => {
  try {
    const { id } = req.params;
    const { acs_responsavel } = req.body;
    if (!acs_responsavel) {
      return res.status(400).json({ error: 'Nome do ACS é obrigatório' });
    }
    const result = await pool.query(
      `UPDATE patients SET etapa_fluxo = 'primeira_escuta', acs_responsavel = $2, inicio_etapa = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND setor = 'Acolhimento' AND etapa_fluxo = 'recepcao' RETURNING *`,
      [id, acs_responsavel]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Paciente não encontrado ou não está na recepção' });
    }
    io.emit('queueUpdate');
    io.emit('acolhimentoUpdate');
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT encaminhar – primeira_escuta -> segunda_escuta
app.put('/api/acolhimento/:id/encaminhar', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      queixa,
      motivo_primeira_escuta,
      equipe_paciente,
      risco_clinico,
      profissional_destino,
      tipo_profissional_destino,
      cpf,
      cartao_sus,
      condicoes_especiais
    } = req.body;
    const queixaFinal = (queixa || motivo_primeira_escuta || '').trim();
    if (!queixaFinal) {
      return res.status(400).json({ error: 'Queixa / Motivo da 1ª Escuta é obrigatório' });
    }
    const equipeFinal = equipe_paciente ? String(equipe_paciente).trim().slice(0, 80) : null;
    const pAntesRes = await pool.query('SELECT * FROM patients WHERE id = $1', [id]);
    if (pAntesRes.rows.length === 0) {
      return res.status(404).json({ error: 'Paciente não encontrado na 1ª Escuta' });
    }
    const prioEscuta1 = preservarOuElevarPrioridade(pAntesRes.rows[0], { condicoes_especiais });

    const result = await pool.query(
      `UPDATE patients
       SET etapa_fluxo = 'segunda_escuta',
           queixa = $2,
           motivo_primeira_escuta = COALESCE(NULLIF(TRIM(motivo_primeira_escuta), ''), $3::text),
           equipe_paciente = COALESCE($4::text, equipe_paciente),
           risco_clinico = $5,
           profissional_destino = $6,
           tipo_profissional_destino = $7,
           cpf = $8,
           cartao_sus = $9,
           condicoes_especiais = COALESCE($10::text, condicoes_especiais),
           prioridade = $11,
           nivel_prioridade = $12,
           tipo_prioridade = COALESCE($13::text, tipo_prioridade),
           inicio_etapa = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND setor = 'Acolhimento' AND etapa_fluxo = 'primeira_escuta'
       RETURNING *`,
      [
        id,
        queixaFinal,
        queixaFinal,
        equipeFinal,
        risco_clinico || 'verde',
        profissional_destino || null,
        tipo_profissional_destino || null,
        cpf || null,
        cartao_sus || null,
        condicoes_especiais || null,
        prioEscuta1.prioridade,
        prioEscuta1.nivel_prioridade,
        prioEscuta1.tipo_prioridade
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Paciente não encontrado ou não está na 1ª Escuta' });
    }
    const patient = result.rows[0];
    // Formata o profissional para aparecer no painel
    patient.profissional = patient.profissional_destino ? `2ª Escuta (${patient.profissional_destino})` : '2ª Escuta';
    
    io.emit('queueUpdate');
    io.emit('acolhimentoUpdate');
    
    // Auto call to TV immediately on transition
    setTimeout(() => {
      io.emit('callPatient', { 
        patient: sanitizarPacientePublico({ ...patient, medico: patient.profissional }), 
        setor: 'Acolhimento', 
        audioUrl: null 
      });
    }, 100);

    // Notify professionals about second-listen patients
    if (risco_clinico === 'vermelho') {
      io.emit('acolhimentoUrgente', { patient, risco: risco_clinico });
    }
    res.json(patient);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT/POST /api/fila/:id/encaminhar-acolhimento — Reencaminhar paciente da 2ª Escuta como Intercorrência do Acolhimento
async function handleEncaminharIntercorrenciaAcolhimento(req, res) {
  const client = await pool.connect();
  try {
    await garantirColunasEscuta(client);
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'ID do paciente inválido.' });
    }

    const {
      setor_destino,
      profissional_destino,
      observacao_segunda_escuta,
      motivo_primeira_escuta,
      equipe_paciente,
      cpf,
      cartao_sus,
      condicoes_especiais
    } = req.body || {};

    const destinoBruto = (setor_destino || '').trim();
    if (!destinoBruto) {
      return res.status(400).json({ error: 'Selecione o setor/profissional de destino do encaminhamento.' });
    }

    // Mapear possíveis rótulos amigáveis ("Médico", "Enfermeiro", "Dentista", etc.) para os setores reais do sistema
    const mapaSetor = {
      'Médico': 'Médico',
      'Medico': 'Médico',
      'Enfermeiro': 'Enfermagem',
      'Enfermeiro(a)': 'Enfermagem',
      'Enfermagem': 'Enfermagem',
      'Dentista': 'Odontologia',
      'Dentista (Odontologia)': 'Odontologia',
      'Odontologia': 'Odontologia',
      'Téc. Enfermagem': 'Téc. Enfermagem',
      'Tec. Enfermagem': 'Téc. Enfermagem',
      'Téc. Enfermagem / Procedimentos': 'Téc. Enfermagem',
      'Vacina': 'Téc. Enfermagem',
      'Sala de Vacina': 'Téc. Enfermagem',
      'Farmácia': 'Farmácia',
      'Farmacia': 'Farmácia',
      'Regulação': 'Regulação',
      'Regulacao': 'Regulação',
      'Acolhimento': 'Acolhimento',
      'Sala de Agendamento': 'Sala de Agendamento'
    };

    const setorReal = mapaSetor[destinoBruto] || (SETORES.includes(destinoBruto) ? destinoBruto : null);
    if (!setorReal) {
      return res.status(400).json({ error: `Setor de destino inválido: ${destinoBruto}` });
    }

    await client.query('BEGIN');

    const pRes = await client.query('SELECT * FROM patients WHERE id = $1 FOR UPDATE', [id]);
    if (pRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Paciente não encontrado.' });
    }
    const patientAntes = pRes.rows[0];
    if (patientAntes.status === 'atendido' || patientAntes.status === 'desistencia') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Este atendimento já foi finalizado.' });
    }

    const horarioAtual = new Date().toLocaleTimeString('pt-BR', {
      timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'
    });

    const motivo1Preservado =
      (patientAntes.motivo_primeira_escuta && String(patientAntes.motivo_primeira_escuta).trim()) ||
      (patientAntes.queixa && String(patientAntes.queixa).trim()) ||
      (motivo_primeira_escuta && String(motivo_primeira_escuta).trim()) ||
      null;

    const obs2Final = observacao_segunda_escuta && String(observacao_segunda_escuta).trim()
      ? String(observacao_segunda_escuta).trim()
      : (patientAntes.observacao_segunda_escuta || null);

    const equipeFinal = (equipe_paciente && String(equipe_paciente).trim())
      ? String(equipe_paciente).trim().slice(0, 80)
      : (patientAntes.equipe_paciente || null);

    // Se o profissional não foi especificado manualmente, tenta inferir pela equipe do paciente para Médico/Enfermagem/Odontologia
    const profDestinoFinal = inferirProfissionalPorEquipe(setorReal, equipeFinal, profissional_destino);

    // Caso especial: Sala de Agendamento
    if (setorReal === 'Sala de Agendamento') {
      const textoQueixaAgend = [
        motivo1Preservado ? `1ª Escuta: ${motivo1Preservado}` : null,
        obs2Final ? `2ª Escuta: ${obs2Final}` : null
      ].filter(Boolean).join(' | ') || 'Intercorrência do Acolhimento';

      await client.query(
        `INSERT INTO ctrl_agendamentos (patient_id, nome, horario, queixa, equipe, cpf6, status, setor_origem, motivo)
         VALUES ($1, $2, $3, $4, $5, $6, 'pendente', '2ª Escuta (Acolhimento)', 'Intercorrência do Acolhimento')`,
        [
          patientAntes.id,
          patientAntes.nome,
          horarioAtual,
          textoQueixaAgend,
          equipeFinal,
          (cpf || patientAntes.cpf || '').slice(0, 6) || null
        ]
      );

      const updAgend = await client.query(
        `UPDATE patients
         SET status = 'atendido',
             etapa_fluxo = 'finalizado',
             equipe_paciente = $2,
             motivo_primeira_escuta = $3,
             observacao_segunda_escuta = $4,
             is_intercorrencia_acolhimento = true,
             setor_destino = 'Sala de Agendamento',
             agendamento_realizado = true,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *`,
        [id, equipeFinal, motivo1Preservado, obs2Final]
      );

      await client.query('COMMIT');
      io.emit('queueUpdate');
      io.emit('acolhimentoUpdate');
      return res.json({
        message: 'Paciente encaminhado para a Sala de Agendamento com sucesso!',
        patient: updAgend.rows[0]
      });
    }

    // Definir tipo de atendimento compatível com o setor de destino mantendo o destaque de Intercorrência
    let tipoAtendimentoFinal = 'Intercorrência (Acolhimento)';
    if (setorReal === 'Téc. Enfermagem' && (destinoBruto === 'Vacina' || destinoBruto === 'Sala de Vacina')) {
      tipoAtendimentoFinal = 'Vacina';
    }

    // Preservar ou elevar prioridade (ex.: paciente prioritário da Recepção ou marcado com Gestante/Criança de Colo/etc. no Acolhimento)
    const prioEscuta2 = preservarOuElevarPrioridade(patientAntes, { condicoes_especiais });

    // Atualizar o paciente para a fila do setor/profissional de destino mantendo intacto o motivo_primeira_escuta e a prioridade
    const updateRes = await client.query(
      `UPDATE patients
       SET setor = $2,
           setor_destino = $3,
           profissional = $4,
           profissional_destino = $5,
           horario = $6,
           status = 'aguardando',
           etapa_fluxo = 'encaminhado_intercorrencia',
           tipo_atendimento = $7,
           origem_transferencia = '2ª Escuta (Acolhimento)',
           is_intercorrencia_acolhimento = true,
           equipe_paciente = $8,
           motivo_primeira_escuta = $9,
           queixa = COALESCE($10::text, queixa),
           observacao_segunda_escuta = $11,
           cpf = COALESCE($12::text, cpf),
           cartao_sus = COALESCE($13::text, cartao_sus),
           condicoes_especiais = COALESCE($14::text, condicoes_especiais),
           prioridade = $15,
           nivel_prioridade = $16,
           tipo_prioridade = COALESCE($17::text, tipo_prioridade),
           sort_order = NULL,
           created_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [
        id,
        setorReal,
        setorReal,
        profDestinoFinal,
        profDestinoFinal,
        horarioAtual,
        tipoAtendimentoFinal,
        equipeFinal,
        motivo1Preservado,
        motivo1Preservado,
        obs2Final,
        cpf || null,
        cartao_sus || null,
        condicoes_especiais || null,
        prioEscuta2.prioridade,
        prioEscuta2.nivel_prioridade,
        prioEscuta2.tipo_prioridade
      ]
    );

    const updatedPatient = updateRes.rows[0];
    if (setorReal === 'Odontologia') {
      await reordenarFilaOdontologia(client);
    } else if (prioEscuta2.prioridade === 'prioritario') {
      await fixarPrioritarioNoTopoDaFila(client, updatedPatient, { fixarPrimeiroDireto: false });
    }

    // Registrar no call_history o log de transferência da 2ª Escuta (SAVEPOINT evita rollback se houver divergência em call_history)
    await client.query('SAVEPOINT sp_hist_interc');
    try {
      await client.query(
        `INSERT INTO call_history (
           patient_id, nome, setor, medico, horario_chamada, profissional,
           prioridade, tipo_prioridade, tipo_atendimento, cpf, cartao_sus,
           acs_responsavel, condicoes_especiais, queixa, risco_clinico,
           equipe_paciente, motivo_primeira_escuta, observacao_segunda_escuta, is_intercorrencia_acolhimento
         )
         VALUES ($1, $2, 'Acolhimento', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, true)`,
        [
          updatedPatient.id,
          updatedPatient.nome,
          profDestinoFinal,
          horarioAtual,
          `➡️ Encaminhado p/ ${setorReal}${profDestinoFinal ? ' (' + profDestinoFinal + ')' : ''}`,
          updatedPatient.prioridade || 'geral',
          updatedPatient.tipo_prioridade || null,
          tipoAtendimentoFinal,
          updatedPatient.cpf || null,
          updatedPatient.cartao_sus || null,
          updatedPatient.acs_responsavel || null,
          updatedPatient.condicoes_especiais || null,
          motivo1Preservado,
          updatedPatient.risco_clinico || null,
          equipeFinal,
          motivo1Preservado,
          obs2Final
        ]
      );
    } catch (histErr) {
      await client.query('ROLLBACK TO SAVEPOINT sp_hist_interc');
      console.warn('[encaminhar-acolhimento] Aviso ao gravar call_history:', histErr.message);
    }

    await client.query('COMMIT');
    await anexarBuscaAtivaDetalhes([updatedPatient], pool);
    io.emit('queueUpdate');
    io.emit('acolhimentoUpdate');

    res.json({
      message: `Paciente encaminhado como Intercorrência do Acolhimento para ${setorReal}${profDestinoFinal ? ' (' + profDestinoFinal + ')' : ''}`,
      patient: updatedPatient
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[encaminhar-acolhimento] Erro:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
}

app.put('/api/fila/:id/encaminhar-acolhimento', handleEncaminharIntercorrenciaAcolhimento);
app.post('/api/fila/:id/encaminhar-acolhimento', handleEncaminharIntercorrenciaAcolhimento);
app.put('/api/acolhimento/:id/encaminhar-intercorrencia', handleEncaminharIntercorrenciaAcolhimento);
app.post('/api/acolhimento/:id/encaminhar-intercorrencia', handleEncaminharIntercorrenciaAcolhimento);

// POST chamar – Dispara chamado no painel sem mudar status
app.post('/api/acolhimento/:id/chamar', async (req, res) => {
  try {
    const { id } = req.params;
    const { destino } = req.body || {};
    const result = await pool.query('SELECT * FROM patients WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Paciente não encontrado' });
    const patient = result.rows[0];
    
    let destinoLimpo = (destino || '2ª Escuta').trim();
    if (/sem designa|se dirija/i.test(destinoLimpo)) {
      destinoLimpo = '2ª Escuta';
    }
    // Insere no histórico para o painel (TV) buscar via polling e tocar o áudio correto
    await pool.query(
      `INSERT INTO call_history (patient_id, nome, setor, medico, horario_chamada) VALUES ($1, $2, $3, $4, $5)`,
      [patient.id, patient.nome, 'Acolhimento', destinoLimpo, new Date().toLocaleTimeString('pt-BR', { hour12: false, hour: '2-digit', minute: '2-digit' })]
    );

    res.json({ message: 'Chamado disparado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT finalizar-escuta1 – Direto da 1ª Escuta para o fim
app.put('/api/acolhimento/:id/finalizar-escuta1', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { queixa, cpf, cartao_sus, agendamento_realizado, condicoes_especiais } = req.body;
    await client.query('BEGIN');
    const pResult = await client.query(
      `SELECT * FROM patients WHERE id = $1 AND setor = 'Acolhimento' AND etapa_fluxo = 'primeira_escuta'`, [id]
    );
    if (pResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Paciente não encontrado na 1ª Escuta' });
    }
    
    // Atualiza patient e finaliza
    const updtResult = await client.query(
      `UPDATE patients SET 
        etapa_fluxo = 'finalizado', status = 'atendido', updated_at = CURRENT_TIMESTAMP,
        queixa = $2, cpf = $3, cartao_sus = $4, agendamento_realizado = $5, condicoes_especiais = COALESCE($6, condicoes_especiais)
       WHERE id = $1 RETURNING *`,
      [id, queixa || null, cpf || null, cartao_sus || null, agendamento_realizado || false, condicoes_especiais || null]
    );
    const patient = updtResult.rows[0];

    // Add to history
    const historyCheck = await client.query(`SELECT id FROM call_history WHERE patient_id = $1 AND setor = 'Acolhimento' ORDER BY created_at DESC LIMIT 1`, [patient.id]);
    if (historyCheck.rows.length > 0) {
      await client.query(
        `UPDATE call_history SET profissional = $1, cpf = $2, cartao_sus = $3, acs_responsavel = $4, agendamento_realizado = $5, condicoes_especiais = $6, queixa = $7, risco_clinico = $8 WHERE id = $9`,
        [patient.profissional_destino, patient.cpf, patient.cartao_sus, patient.acs_responsavel, patient.agendamento_realizado, patient.condicoes_especiais, patient.queixa, patient.risco_clinico, historyCheck.rows[0].id]
      );
    } else {
      const horarioChamada = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
      await client.query(
        `INSERT INTO call_history (patient_id, nome, setor, horario_chamada, prioridade, tipo_prioridade, profissional, cpf, cartao_sus, acs_responsavel, agendamento_realizado, condicoes_especiais, queixa, risco_clinico)
         VALUES ($1, $2, 'Acolhimento', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [patient.id, patient.nome, horarioChamada, patient.prioridade, patient.tipo_prioridade, patient.profissional_destino, patient.cpf, patient.cartao_sus, patient.acs_responsavel, patient.agendamento_realizado, patient.condicoes_especiais, patient.queixa, patient.risco_clinico]
      );
    }
    await client.query('COMMIT');
    io.emit('queueUpdate');
    io.emit('acolhimentoUpdate');
    res.json({ message: 'Atendimento finalizado na 1ª Escuta', patient });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// PUT finalizar – segunda_escuta -> finalizado (registra no call_history)
app.put('/api/acolhimento/:id/finalizar', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { gravidade_final, agendamento_realizado, condicoes_especiais } = req.body;
    await client.query('BEGIN');
    const pResult = await client.query(
      `SELECT * FROM patients WHERE id = $1 AND setor = 'Acolhimento' AND etapa_fluxo = 'segunda_escuta'`,
      [id]
    );
    if (pResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Paciente não encontrado ou não está na 2ª Escuta' });
    }
    
    // Use data from the initial check to provide fallbacks for editing
    const existingPatient = pResult.rows[0];

    // Mark as finalized and update edited fields
    const updtResult = await client.query(
      `UPDATE patients SET 
        etapa_fluxo = 'finalizado', status = 'atendido', updated_at = CURRENT_TIMESTAMP,
        gravidade_final = $2, agendamento_realizado = $3,
        queixa = $4, cpf = $5, cartao_sus = $6, condicoes_especiais = COALESCE($7, condicoes_especiais)
       WHERE id = $1 RETURNING *`,
      [
        id, 
        gravidade_final || null, 
        agendamento_realizado || false, 
        req.body.queixa || existingPatient.queixa, 
        req.body.cpf || existingPatient.cpf, 
        req.body.cartao_sus || existingPatient.cartao_sus,
        condicoes_especiais || null
      ]
    );
    const patient = updtResult.rows[0];

    // Add to history
    const historyCheck = await client.query(`SELECT id FROM call_history WHERE patient_id = $1 AND setor = 'Acolhimento' ORDER BY created_at DESC LIMIT 1`, [patient.id]);
    if (historyCheck.rows.length > 0) {
      await client.query(
        `UPDATE call_history SET profissional = $1, cpf = $2, cartao_sus = $3, acs_responsavel = $4, gravidade_final = $5, agendamento_realizado = $6, condicoes_especiais = $7, queixa = $8, risco_clinico = $9 WHERE id = $10`,
        [patient.profissional_destino, patient.cpf, patient.cartao_sus, patient.acs_responsavel, patient.gravidade_final, patient.agendamento_realizado, patient.condicoes_especiais, patient.queixa, patient.risco_clinico, historyCheck.rows[0].id]
      );
    } else {
      const horarioChamada = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
      await client.query(
        `INSERT INTO call_history (patient_id, nome, setor, horario_chamada, prioridade, tipo_prioridade, profissional, cpf, cartao_sus, acs_responsavel, gravidade_final, agendamento_realizado, condicoes_especiais, queixa, risco_clinico)
         VALUES ($1, $2, 'Acolhimento', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [patient.id, patient.nome, horarioChamada, patient.prioridade, patient.tipo_prioridade, patient.profissional_destino, patient.cpf, patient.cartao_sus, patient.acs_responsavel, patient.gravidade_final, patient.agendamento_realizado, patient.condicoes_especiais, patient.queixa, patient.risco_clinico]
      );
    }
    await client.query('COMMIT');
    io.emit('queueUpdate');
    io.emit('acolhimentoUpdate');
    res.json({ message: 'Atendimento finalizado', patient });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// ====== API: PROFISSIONAIS CADASTRO ======

// GET – listar profissionais com profissão
app.get('/api/profissionais', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM profissionais_cadastro WHERE ativo = true ORDER BY nome ASC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT – atualizar profissão de um profissional
app.put('/api/profissionais/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { profissao } = req.body;
    const result = await pool.query(
      'UPDATE profissionais_cadastro SET profissao = $2 WHERE id = $1 RETURNING *',
      [id, profissao || null]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Profissional não encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ====== API: RESPONSÁVEIS DE SETORES DE APOIO ======

// GET – listar responsáveis
app.get('/api/responsaveis-setor', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM responsaveis_setor WHERE ativo = true ORDER BY setor ASC, nome ASC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST – criar responsável
app.post('/api/responsaveis-setor', async (req, res) => {
  try {
    const { nome, setor, cargo } = req.body;
    if (!nome || !setor) {
      return res.status(400).json({ error: 'Nome e setor são obrigatórios' });
    }
    const result = await pool.query(
      'INSERT INTO responsaveis_setor (nome, setor, cargo) VALUES ($1, $2, $3) RETURNING *',
      [nome, setor, cargo || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Responsável já cadastrado nesse setor' });
    }
    res.status(500).json({ error: error.message });
  }
});

// PUT – editar responsável
app.put('/api/responsaveis-setor/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, setor, cargo } = req.body;
    const result = await pool.query(
      'UPDATE responsaveis_setor SET nome = COALESCE($2, nome), setor = COALESCE($3, setor), cargo = COALESCE($4, cargo) WHERE id = $1 RETURNING *',
      [id, nome || null, setor || null, cargo || null]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Responsável não encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE – remover responsável
app.delete('/api/responsaveis-setor/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM responsaveis_setor WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Responsável não encontrado' });
    }
    res.json({ message: 'Responsável removido', responsavel: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ====== API: MENSAGENS ENVIADAS (Relatório) ======

// POST – registrar envio de mensagem
app.post('/api/mensagens-enviadas', async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mensagens_enviadas (
        id SERIAL PRIMARY KEY,
        agendamento_id INTEGER,
        profissional TEXT,
        paciente TEXT NOT NULL,
        template TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const { agendamento_id, profissional, paciente, template } = req.body;
    if (!paciente) {
      return res.status(400).json({ error: 'Paciente é obrigatório' });
    }
    const result = await pool.query(
      'INSERT INTO mensagens_enviadas (agendamento_id, profissional, paciente, template) VALUES ($1, $2, $3, $4) RETURNING *',
      [agendamento_id || null, profissional || null, paciente, template || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao salvar mensagem enviada:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET – relatório de mensagens por dia
app.get('/api/mensagens-enviadas/relatorio', async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mensagens_enviadas (
        id SERIAL PRIMARY KEY,
        agendamento_id INTEGER,
        profissional TEXT,
        paciente TEXT NOT NULL,
        template TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const { data } = req.query;
    const targetDate = data || new Date().toISOString().split('T')[0];

    const porProfissional = await pool.query(
      `SELECT COALESCE(NULLIF(TRIM(profissional), ''), 'Sem profissional') as profissional, COUNT(*) as total
       FROM mensagens_enviadas
       WHERE DATE(created_at AT TIME ZONE 'America/Sao_Paulo') = $1::date
       GROUP BY COALESCE(NULLIF(TRIM(profissional), ''), 'Sem profissional')
       ORDER BY total DESC`,
      [targetDate]
    );
    const totalResult = await pool.query(
      `SELECT COUNT(*) as total
       FROM mensagens_enviadas
       WHERE DATE(created_at AT TIME ZONE 'America/Sao_Paulo') = $1::date`,
      [targetDate]
    );
    res.json({
      data: targetDate,
      total: parseInt(totalResult.rows[0].total) || 0,
      porProfissional: porProfissional.rows.map(r => ({ profissional: r.profissional, total: parseInt(r.total) }))
    });
  } catch (error) {
    console.error('Erro ao obter relatorio de mensagens:', error);
    res.status(500).json({ error: error.message });
  }
});

// ====== PARTE B: BUSCA ATIVA (alumIA) & RELATÓRIOS ADMIN ======

// GET – listar motivos de busca ativa (?all=1 retorna ativos e inativos; padrão retorna apenas ativos)
app.get('/api/motivos-busca-ativa', async (req, res) => {
  try {
    const mostrarTodos = req.query.all === '1' || req.query.all === 'true';
    const query = mostrarTodos
      ? `SELECT id, descricao, setor_sugerido, ativo FROM motivos_busca_ativa ORDER BY CASE WHEN LOWER(descricao) = 'outro' THEN 1 ELSE 0 END ASC, id ASC`
      : `SELECT id, descricao, setor_sugerido, ativo FROM motivos_busca_ativa WHERE ativo = true ORDER BY CASE WHEN LOWER(descricao) = 'outro' THEN 1 ELSE 0 END ASC, id ASC`;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST – adicionar novo motivo de busca ativa (Admin)
app.post('/api/admin/motivos-busca-ativa', async (req, res) => {
  try {
    const { descricao, setor_sugerido, senha } = req.body || {};
    if (!isValidAdminPass(senha)) {
      return res.status(403).json({ error: 'Senha administrativa incorreta' });
    }
    const descLimpa = String(descricao || '').trim().slice(0, 120);
    const setorLimpo = String(setor_sugerido || '').trim().slice(0, 60);
    if (!descLimpa || !setorLimpo) {
      return res.status(400).json({ error: 'Descrição e setor sugerido são obrigatórios (máx. 120 e 60 caracteres).' });
    }
    const result = await pool.query(
      `INSERT INTO motivos_busca_ativa (descricao, setor_sugerido, ativo)
       VALUES ($1, $2, true)
       RETURNING *`,
      [descLimpa, setorLimpo]
    );
    const usuarioDisp = await obterUsuarioDispositivo(req, pool, 'Admin');
    await pool.query(
      `INSERT INTO log_busca_ativa (acao, entrada_fila_id, motivo_id, motivo_descricao, detalhes, usuario_dispositivo, data_hora)
       VALUES ('admin_criar_motivo', NULL, $1, $2, $3, $4, NOW())`,
      [result.rows[0].id, descLimpa, `Setor sugerido: ${setorLimpo}`, usuarioDisp]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Já existe um motivo com esta descrição.' });
    }
    res.status(500).json({ error: error.message });
  }
});

// PUT – renomear ou ativar/desativar motivo de busca ativa (Admin)
app.put('/api/admin/motivos-busca-ativa/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { descricao, setor_sugerido, ativo, senha } = req.body || {};
    if (!isValidAdminPass(senha)) {
      return res.status(403).json({ error: 'Senha administrativa incorreta' });
    }
    const atualRes = await pool.query('SELECT * FROM motivos_busca_ativa WHERE id = $1', [id]);
    if (atualRes.rows.length === 0) {
      return res.status(404).json({ error: 'Motivo não encontrado' });
    }
    const atual = atualRes.rows[0];
    const novaDesc = descricao !== undefined ? String(descricao).trim().slice(0, 120) : atual.descricao;
    const novoSetor = setor_sugerido !== undefined ? String(setor_sugerido).trim().slice(0, 60) : atual.setor_sugerido;
    const novoAtivo = typeof ativo === 'boolean' ? ativo : atual.ativo;

    if (!novaDesc || !novoSetor) {
      return res.status(400).json({ error: 'Descrição e setor sugerido não podem ficar vazios.' });
    }

    const result = await pool.query(
      `UPDATE motivos_busca_ativa
       SET descricao = $2, setor_sugerido = $3, ativo = $4
       WHERE id = $1
       RETURNING *`,
      [id, novaDesc, novoSetor, novoAtivo]
    );

    const usuarioDisp = await obterUsuarioDispositivo(req, pool, 'Admin');
    await pool.query(
      `INSERT INTO log_busca_ativa (acao, entrada_fila_id, motivo_id, motivo_descricao, detalhes, usuario_dispositivo, data_hora)
       VALUES ('admin_editar_motivo', NULL, $1, $2, $3, $4, NOW())`,
      [id, novaDesc, `Setor: ${novoSetor} | Ativo: ${novoAtivo}`, usuarioDisp]
    );

    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Já existe outro motivo com esta descrição.' });
    }
    res.status(500).json({ error: error.message });
  }
});

// GET – resumo leve e sem cache (no-store) de todos os itens de busca ativa dos pacientes na fila do dia
app.get('/api/busca-ativa/resumo', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT bi.id, bi.entrada_fila_id, bi.motivo_id, bi.texto_outro, bi.ofertado, bi.ofertado_por, bi.ofertado_em,
              m.descricao AS motivo_descricao, m.setor_sugerido
       FROM busca_ativa_itens bi
       JOIN motivos_busca_ativa m ON m.id = bi.motivo_id
       JOIN patients p ON p.id = bi.entrada_fila_id
       WHERE p.status NOT IN ('atendido', 'desistencia')
       ORDER BY bi.id ASC`
    );
    const porPaciente = {};
    result.rows.forEach(item => {
      if (!porPaciente[item.entrada_fila_id]) porPaciente[item.entrada_fila_id] = [];
      porPaciente[item.entrada_fila_id].push(item);
    });
    res.json(porPaciente);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET – obter itens de busca ativa de um paciente da fila
app.get('/api/patients/:id/busca-ativa', async (req, res) => {
  try {
    const { id } = req.params;
    const pRes = await pool.query('SELECT id, nome, setor, busca_ativa, busca_ativa_ofertada FROM patients WHERE id = $1', [id]);
    if (pRes.rows.length === 0) {
      return res.status(404).json({ error: 'Paciente não encontrado na fila ativa' });
    }
    const itensRes = await pool.query(
      `SELECT bi.id, bi.entrada_fila_id, bi.motivo_id, bi.texto_outro, bi.ofertado, bi.ofertado_por, bi.ofertado_em,
              m.descricao AS motivo_descricao, m.setor_sugerido
       FROM busca_ativa_itens bi
       JOIN motivos_busca_ativa m ON m.id = bi.motivo_id
       WHERE bi.entrada_fila_id = $1
       ORDER BY bi.id ASC`,
      [id]
    );
    res.json({
      patient: pRes.rows[0],
      itens: itensRes.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT – salvar/editar/remover marcações de busca ativa de um paciente (JAMAIS altera prioridade ou ordem da fila)
app.put('/api/patients/:id/busca-ativa', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { itens, setor_operador } = req.body || {};

    if (!Array.isArray(itens)) {
      return res.status(400).json({ error: 'Formato inválido: itens deve ser uma lista.' });
    }

    await client.query('BEGIN');

    const pRes = await client.query('SELECT id, nome, setor, busca_ativa FROM patients WHERE id = $1 FOR UPDATE', [id]);
    if (pRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Paciente não encontrado na fila' });
    }
    const patient = pRes.rows[0];

    const existentesRes = await client.query(
      `SELECT bi.*, m.descricao AS motivo_descricao
       FROM busca_ativa_itens bi
       JOIN motivos_busca_ativa m ON m.id = bi.motivo_id
       WHERE bi.entrada_fila_id = $1`,
      [id]
    );
    const existentesMap = {};
    existentesRes.rows.forEach(r => {
      existentesMap[Number(r.motivo_id)] = r;
    });

    // Validar motivos enviados
    const itensLimpos = [];
    const vistos = new Set();
    for (const item of itens) {
      const motivoId = parseInt(item.motivo_id, 10);
      if (!motivoId || isNaN(motivoId) || vistos.has(motivoId)) continue;
      vistos.add(motivoId);
      const textoOutro = item.texto_outro ? String(item.texto_outro).trim().slice(0, 120) : null;
      itensLimpos.push({ motivo_id: motivoId, texto_outro: textoOutro });
    }

    const usuarioDisp = await obterUsuarioDispositivo(req, client, setor_operador || 'Recepção');

    if (itensLimpos.length === 0) {
      // Remoção total das marcações de busca ativa do paciente
      await client.query('DELETE FROM busca_ativa_itens WHERE entrada_fila_id = $1', [id]);
      await client.query(
        'UPDATE patients SET busca_ativa = false, busca_ativa_ofertada = false WHERE id = $1',
        [id]
      );
      if (existentesRes.rows.length > 0) {
        for (const rem of existentesRes.rows) {
          await client.query(
            `INSERT INTO log_busca_ativa (acao, entrada_fila_id, motivo_id, motivo_descricao, detalhes, usuario_dispositivo, data_hora)
             VALUES ('remover_item', $1, $2, $3, 'Motivo removido pelo usuário', $4, NOW())`,
            [id, rem.motivo_id, rem.motivo_descricao, usuarioDisp]
          );
        }
        await client.query(
          `INSERT INTO log_busca_ativa (acao, entrada_fila_id, motivo_id, motivo_descricao, detalhes, usuario_dispositivo, data_hora)
           VALUES ('remover', $1, NULL, NULL, $2, $3, NOW())`,
          [id, `Marcações removidas (${existentesRes.rows.map(e => e.motivo_descricao).join('; ')})`, usuarioDisp]
        );
      }
      await client.query('COMMIT');
      io.emit('queueUpdate');
      return res.json({
        message: 'Busca ativa removida do paciente.',
        busca_ativa: false,
        busca_ativa_ofertada: false,
        busca_ativa_detalhes: []
      });
    }

    // Buscar metadados dos motivos selecionados
    const motivosIds = itensLimpos.map(i => i.motivo_id);
    const motivosDbRes = await client.query(
      'SELECT id, descricao, setor_sugerido FROM motivos_busca_ativa WHERE id = ANY($1::int[])',
      [motivosIds]
    );
    const motivosDbMap = {};
    motivosDbRes.rows.forEach(m => { motivosDbMap[Number(m.id)] = m; });

    // Validar que se "Outro" foi marcado, texto_outro tenha no máx 120 chars
    for (const item of itensLimpos) {
      const m = motivosDbMap[item.motivo_id];
      if (!m) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Motivo inválido (${item.motivo_id}).` });
      }
      if (m.descricao.toLowerCase() === 'outro' && (!item.texto_outro || !item.texto_outro.trim())) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Para o motivo "Outro", descreva a pendência (máx. 120 caracteres).' });
      }
    }

    // Identificar e logar motivos desmarcados na edição antes de apagar de busca_ativa_itens
    const motivosSet = new Set(motivosIds);
    for (const antigo of existentesRes.rows) {
      if (!motivosSet.has(Number(antigo.motivo_id))) {
        await client.query(
          `INSERT INTO log_busca_ativa (acao, entrada_fila_id, motivo_id, motivo_descricao, detalhes, usuario_dispositivo, data_hora)
           VALUES ('remover_item', $1, $2, $3, 'Motivo desmarcado na edição', $4, NOW())`,
          [id, antigo.motivo_id, antigo.motivo_descricao, usuarioDisp]
        );
      }
    }

    // Remover motivos desmarcados
    await client.query(
      'DELETE FROM busca_ativa_itens WHERE entrada_fila_id = $1 AND NOT (motivo_id = ANY($2::int[]))',
      [id, motivosIds]
    );

    // Inserir novos ou atualizar existentes (preservando ofertado se já havia sido ofertado)
    for (const item of itensLimpos) {
      const m = motivosDbMap[item.motivo_id];
      const existente = existentesMap[item.motivo_id];
      if (existente) {
        await client.query(
          'UPDATE busca_ativa_itens SET texto_outro = $2 WHERE id = $1',
          [existente.id, item.texto_outro]
        );
      } else {
        await client.query(
          `INSERT INTO busca_ativa_itens (entrada_fila_id, motivo_id, texto_outro, ofertado)
           VALUES ($1, $2, $3, false)`,
          [id, item.motivo_id, item.texto_outro]
        );
        // Registrar presença no log por motivo novo marcado (usado no relatório Parte B mesmo após reset diário)
        const descFinal = m.descricao.toLowerCase() === 'outro' && item.texto_outro
          ? `Outro: ${item.texto_outro}`
          : m.descricao;
        await client.query(
          `INSERT INTO log_busca_ativa (acao, entrada_fila_id, motivo_id, motivo_descricao, detalhes, usuario_dispositivo, data_hora)
           VALUES ('marcar_item', $1, $2, $3, $4, $5, NOW())`,
          [id, m.id, m.descricao, descFinal, usuarioDisp]
        );
      }
    }

    // Verificar se todos os itens atuais já estão ofertados
    const statusItensRes = await client.query(
      'SELECT bool_and(COALESCE(ofertado, false)) AS todos_ofertados FROM busca_ativa_itens WHERE entrada_fila_id = $1',
      [id]
    );
    const todosOfertados = Boolean(statusItensRes.rows[0]?.todos_ofertados);

    // Atualizar apenas os sinalizadores informativos (NÃO toca em sort_order, nivel_prioridade, prioridade nem updated_at de chamada)
    await client.query(
      'UPDATE patients SET busca_ativa = true, busca_ativa_ofertada = $2 WHERE id = $1',
      [id, todosOfertados]
    );

    const acaoGeral = existentesRes.rows.length > 0 ? 'editar' : 'marcar';
    const resumoMotivos = itensLimpos.map(i => {
      const m = motivosDbMap[i.motivo_id];
      return m.descricao.toLowerCase() === 'outro' && i.texto_outro ? `Outro (${i.texto_outro})` : m.descricao;
    }).join('; ');

    await client.query(
      `INSERT INTO log_busca_ativa (acao, entrada_fila_id, motivo_id, motivo_descricao, detalhes, usuario_dispositivo, data_hora)
       VALUES ($1, $2, NULL, NULL, $3, $4, NOW())`,
      [acaoGeral, id, resumoMotivos, usuarioDisp]
    );

    await client.query('COMMIT');

    const pFinal = await pool.query('SELECT * FROM patients WHERE id = $1', [id]);
    await anexarBuscaAtivaDetalhes(pFinal.rows, pool);

    io.emit('queueUpdate');
    res.json({
      message: 'Busca ativa (alumIA) atualizada com sucesso.',
      patient: pFinal.rows[0],
      busca_ativa_detalhes: pFinal.rows[0]?.busca_ativa_detalhes || []
    });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// POST – registrar "Oferta feita" (por motivo específico ou todos os motivos do paciente)
app.post('/api/patients/:id/busca-ativa/ofertar', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { item_id, motivo_id, setor_operador, profissional_operador } = req.body || {};

    await client.query('BEGIN');

    const pRes = await client.query('SELECT id, nome, setor, busca_ativa FROM patients WHERE id = $1 FOR UPDATE', [id]);
    if (pRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Paciente não encontrado na fila' });
    }

    const rotulo = profissional_operador || setor_operador || pRes.rows[0].setor || 'Equipe';
    const usuarioDisp = await obterUsuarioDispositivo(req, client, rotulo);

    let whereClause = 'entrada_fila_id = $1';
    const params = [id, usuarioDisp];
    if (item_id) {
      params.push(parseInt(item_id, 10));
      whereClause += ` AND id = $${params.length}`;
    } else if (motivo_id) {
      params.push(parseInt(motivo_id, 10));
      whereClause += ` AND motivo_id = $${params.length}`;
    }

    const updRes = await client.query(
      `UPDATE busca_ativa_itens
       SET ofertado = true, ofertado_por = $2, ofertado_em = NOW()
       WHERE ${whereClause}
       RETURNING *`,
      params
    );

    if (updRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Nenhum item de busca ativa encontrado para registrar oferta.' });
    }

    // Registrar auditoria por cada item ofertado
    for (const item of updRes.rows) {
      const mRes = await client.query('SELECT descricao FROM motivos_busca_ativa WHERE id = $1', [item.motivo_id]);
      const mDesc = mRes.rows[0]?.descricao || 'Motivo';
      await client.query(
        `INSERT INTO log_busca_ativa (acao, entrada_fila_id, motivo_id, motivo_descricao, detalhes, usuario_dispositivo, data_hora)
         VALUES ('ofertar', $1, $2, $3, $4, $5, NOW())`,
        [id, item.motivo_id, mDesc, item.texto_outro ? `Oferta feita (${item.texto_outro})` : 'Oferta feita', usuarioDisp]
      );
    }

    const statusItensRes = await client.query(
      'SELECT bool_and(COALESCE(ofertado, false)) AS todos_ofertados FROM busca_ativa_itens WHERE entrada_fila_id = $1',
      [id]
    );
    const todosOfertados = Boolean(statusItensRes.rows[0]?.todos_ofertados);

    await client.query(
      'UPDATE patients SET busca_ativa_ofertada = $2 WHERE id = $1',
      [id, todosOfertados]
    );

    await client.query('COMMIT');

    const pFinal = await pool.query('SELECT * FROM patients WHERE id = $1', [id]);
    await anexarBuscaAtivaDetalhes(pFinal.rows, pool);

    io.emit('queueUpdate');
    res.json({
      message: 'Oferta registrada com sucesso!',
      patient: pFinal.rows[0],
      busca_ativa_detalhes: pFinal.rows[0]?.busca_ativa_detalhes || []
    });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// GET – Relatório Admin Unificado (Parte A + Parte B) com filtro por Dia/Período e Turno no fuso America/Recife
app.get('/api/admin/relatorio-prioridade-busca', async (req, res) => {
  try {
    const hojeRecife = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Recife' }).format(new Date());
    const dataInicio = (req.query.data_inicio || req.query.data || hojeRecife).trim();
    const dataFim = (req.query.data_fim || req.query.data || dataInicio).trim();
    const periodo = (req.query.periodo || 'integral').trim(); // 'integral' | 'manha' | 'tarde'

    let turnoFilterPrioridade = '';
    let turnoFilterBusca = '';
    if (periodo === 'manha') {
      turnoFilterPrioridade = ` AND EXTRACT(HOUR FROM data_hora AT TIME ZONE 'America/Recife') < 12`;
      turnoFilterBusca = ` AND EXTRACT(HOUR FROM l.data_hora AT TIME ZONE 'America/Recife') < 12`;
    } else if (periodo === 'tarde') {
      turnoFilterPrioridade = ` AND EXTRACT(HOUR FROM data_hora AT TIME ZONE 'America/Recife') >= 12`;
      turnoFilterBusca = ` AND EXTRACT(HOUR FROM l.data_hora AT TIME ZONE 'America/Recife') >= 12`;
    }

    // --- PARTE A: Tempo médio e máximo de espera por nível de prioridade (1, 2 e 3) e acionamentos da Regra (a) ---
    const niveisRes = await pool.query(
      `SELECT
         nivel_calculado,
         COUNT(*) AS total_chamados,
         ROUND(AVG(COALESCE(espera_min, 0)), 1) AS media_espera_min,
         ROUND(MAX(COALESCE(espera_min, 0)), 1) AS max_espera_min
       FROM log_prioridade
       WHERE DATE(data_hora AT TIME ZONE 'America/Recife') BETWEEN $1::date AND $2::date
       ${turnoFilterPrioridade}
       GROUP BY nivel_calculado
       ORDER BY nivel_calculado ASC`,
      [dataInicio, dataFim]
    );

    const regrasRes = await pool.query(
      `SELECT
         regra_aplicada,
         COUNT(*) AS total
       FROM log_prioridade
       WHERE DATE(data_hora AT TIME ZONE 'America/Recife') BETWEEN $1::date AND $2::date
       ${turnoFilterPrioridade}
       GROUP BY regra_aplicada`,
      [dataInicio, dataFim]
    );

    const niveisMap = {
      1: { nivel: 1, descricao: 'Nível 1 (80+ anos - Superprioridade)', total_chamados: 0, media_espera_min: 0, max_espera_min: 0 },
      2: { nivel: 2, descricao: 'Nível 2 (60 a 79 anos / Prioritário Legal)', total_chamados: 0, media_espera_min: 0, max_espera_min: 0 },
      3: { nivel: 3, descricao: 'Nível 3 (Normal / < 60 anos)', total_chamados: 0, media_espera_min: 0, max_espera_min: 0 }
    };
    niveisRes.rows.forEach(r => {
      const nv = Number(r.nivel_calculado);
      if (niveisMap[nv]) {
        niveisMap[nv].total_chamados = parseInt(r.total_chamados, 10) || 0;
        niveisMap[nv].media_espera_min = parseFloat(r.media_espera_min) || 0;
        niveisMap[nv].max_espera_min = parseFloat(r.max_espera_min) || 0;
      }
    });

    let regraAAcionada = 0;
    const porRegra = { a: 0, b: 0, c: 0, d: 0 };
    regrasRes.rows.forEach(r => {
      const reg = String(r.regra_aplicada || '').trim();
      const cnt = parseInt(r.total, 10) || 0;
      if (porRegra[reg] !== undefined) porRegra[reg] = cnt;
      if (reg === 'a') regraAAcionada = cnt;
    });

    // --- PARTE B: Total de pacientes de busca ativa que compareceram por motivo e % com "Oferta feita" ---
    // Consolida o estado final de cada par (dia_recife, entrada_fila_id, motivo_id) para:
    // 1. Evitar colisão de entrada_fila_id após /api/reset em dias diferentes.
    // 2. Descontar motivos marcados e depois removidos ('remover_item') no mesmo dia para aquele paciente.
    const motivosBuscaRes = await pool.query(
      `WITH estado_item AS (
         SELECT
           DATE(l.data_hora AT TIME ZONE 'America/Recife') AS dia_recife,
           l.entrada_fila_id,
           l.motivo_id,
           (ARRAY_AGG(l.acao ORDER BY l.data_hora DESC, l.id DESC) FILTER (WHERE l.acao IN ('marcar_item', 'remover_item')))[1] AS ultima_acao_marcacao,
           BOOL_OR(l.acao = 'ofertar') AS foi_ofertado
         FROM log_busca_ativa l
         WHERE l.entrada_fila_id IS NOT NULL
           AND l.motivo_id IS NOT NULL
           AND DATE(l.data_hora AT TIME ZONE 'America/Recife') BETWEEN $1::date AND $2::date
           ${turnoFilterBusca}
         GROUP BY DATE(l.data_hora AT TIME ZONE 'America/Recife'), l.entrada_fila_id, l.motivo_id
       ),
       itens_ativos AS (
         SELECT dia_recife, entrada_fila_id, motivo_id, foi_ofertado
         FROM estado_item
         WHERE ultima_acao_marcacao = 'marcar_item'
       )
       SELECT
         m.id AS motivo_id,
         m.descricao,
         m.setor_sugerido,
         m.ativo,
         COUNT(ia.entrada_fila_id) AS total_pacientes,
         COUNT(ia.entrada_fila_id) FILTER (WHERE ia.foi_ofertado = true) AS total_ofertados
       FROM motivos_busca_ativa m
       LEFT JOIN itens_ativos ia ON ia.motivo_id = m.id
       GROUP BY m.id, m.descricao, m.setor_sugerido, m.ativo
       ORDER BY total_pacientes DESC, m.id ASC`,
      [dataInicio, dataFim]
    );

    const resumoPacientesBuscaRes = await pool.query(
      `WITH estado_item AS (
         SELECT
           DATE(l.data_hora AT TIME ZONE 'America/Recife') AS dia_recife,
           l.entrada_fila_id,
           l.motivo_id,
           (ARRAY_AGG(l.acao ORDER BY l.data_hora DESC, l.id DESC) FILTER (WHERE l.acao IN ('marcar_item', 'remover_item')))[1] AS ultima_acao_marcacao,
           BOOL_OR(l.acao = 'ofertar') AS foi_ofertado
         FROM log_busca_ativa l
         WHERE l.entrada_fila_id IS NOT NULL
           AND l.motivo_id IS NOT NULL
           AND DATE(l.data_hora AT TIME ZONE 'America/Recife') BETWEEN $1::date AND $2::date
           ${turnoFilterBusca}
         GROUP BY DATE(l.data_hora AT TIME ZONE 'America/Recife'), l.entrada_fila_id, l.motivo_id
       ),
       itens_ativos AS (
         SELECT dia_recife, entrada_fila_id, motivo_id, foi_ofertado
         FROM estado_item
         WHERE ultima_acao_marcacao = 'marcar_item'
       )
       SELECT
         COUNT(DISTINCT (dia_recife, entrada_fila_id)) AS total_pacientes_busca,
         COUNT(DISTINCT CASE WHEN foi_ofertado = true THEN (dia_recife, entrada_fila_id) END) AS total_pacientes_ofertados
       FROM itens_ativos`,
      [dataInicio, dataFim]
    );

    const totalPacBusca = parseInt(resumoPacientesBuscaRes.rows[0]?.total_pacientes_busca, 10) || 0;
    const totalPacOfertados = parseInt(resumoPacientesBuscaRes.rows[0]?.total_pacientes_ofertados, 10) || 0;
    const percentualGeralOfertado = totalPacBusca > 0
      ? Number(((totalPacOfertados / totalPacBusca) * 100).toFixed(1))
      : 0;

    const porMotivo = motivosBuscaRes.rows.map(r => {
      const tot = parseInt(r.total_pacientes, 10) || 0;
      const ofe = Math.min(tot, parseInt(r.total_ofertados, 10) || 0);
      const pct = tot > 0 ? Number(((ofe / tot) * 100).toFixed(1)) : 0;
      return {
        motivo_id: r.motivo_id,
        descricao: r.descricao,
        setor_sugerido: r.setor_sugerido,
        ativo: r.ativo,
        total_pacientes: tot,
        total_ofertados: ofe,
        percentual_ofertado: pct
      };
    });

    res.json({
      filtro: {
        data_inicio: dataInicio,
        data_fim: dataFim,
        periodo,
        fuso: 'America/Recife'
      },
      config_prioridade: CONFIG_PRIORIDADE,
      parteA: {
        por_nivel: [niveisMap[1], niveisMap[2], niveisMap[3]],
        regra_a_acionada: regraAAcionada,
        por_regra: porRegra
      },
      parteB: {
        total_pacientes_busca_ativa: totalPacBusca,
        total_pacientes_com_oferta: totalPacOfertados,
        percentual_geral_oferta: percentualGeralOfertado,
        por_motivo: porMotivo
      }
    });
  } catch (error) {
    console.error('Erro em /api/admin/relatorio-prioridade-busca:', error);
    res.status(500).json({ error: error.message });
  }
});

/* ============================================================================
 * STUB FUTURO (NÃO IMPLEMENTADO NESTA FASE — PREPARAÇÃO PARA IMPORTAÇÃO CSV ALUMIA)
 * ============================================================================
 * Quando a Secretaria de Saúde / Conecta Saúde liberar exportação padronizada CSV
 * do painel alumIA (recife.pe.radarsaude.com.br):
 *
 * // app.post('/api/admin/alumia/import-csv', async (req, res) => {
 * //   // 1. Validar senha administrativa (isValidAdminPass)
 * //   // 2. Receber lote CSV em memória (sem gravar diagnóstico/CID, apenas nome/CNS/pendência administrativa)
 * //   // 3. Cruzar com a fila do dia (patients) para pré-sugerir o sinalizador "Busca ativa (alumIA)" na recepção
 * //   // 4. Descartar dados ao final do expediente seguindo a rotina de limpeza diária (/api/reset)
 * // });
 * ============================================================================ */

// Serve dashboard page
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});



// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Database: PostgreSQL (Neon)`);
  // initDB() já foi chamado na linha de boot (antes deste listen).
  // NÃO chamar de novo aqui para evitar ~15 ALTER TABLE queries extras
  // a cada restart, que impediriam o Auto-suspend do Neon.
});
