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

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = 'chico123';

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
    res.set('Cache-Control', 'public, s-maxage=3, stale-while-revalidate=2');
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
const CANAIS_CHAT = ['geral', 'acolhimento', 'farmacia', 'regulacao', 'medico', 'enfermagem', 'odontologia', 'tec_enfermagem', 'gerencia'];

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
    
    console.log('✅ Banco de dados inicializado com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao inicializar banco de dados:', error.message);
  }
}

initDB();

// ====== API Routes ======

// Verify admin password
app.post('/api/verify-admin', (req, res) => {
  const { senha } = req.body;
  if (senha === ADMIN_PASSWORD) {
    res.json({ valid: true });
  } else {
    res.status(403).json({ valid: false, error: 'Senha incorreta' });
  }
});

// Get all queues (sorted: priority first, then arrival order)
app.get('/api/queues', async (req, res) => {
  try {
    const queues = {};
    SETORES.forEach(s => queues[s] = []);

    const result = await pool.query(
      `SELECT * FROM patients WHERE status NOT IN ('atendido', 'desistencia')
       ORDER BY
         CASE WHEN prioridade = 'prioritario' THEN 0 ELSE 1 END ASC,
         COALESCE(sort_order, 2147483647) ASC,
         created_at AT TIME ZONE 'America/Sao_Paulo' ASC`
    );

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

// Add patient
app.post('/api/patients', async (req, res) => {
  try {
    const { nome, setor, prioridade, tipo_prioridade, tipo_atendimento, profissional, condicoes_especiais, etapa_fluxo } = req.body;

    if (!nome || !setor) {
      return res.status(400).json({ error: 'Nome e setor são obrigatórios' });
    }

    const horario = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

    const result = await pool.query(
      `INSERT INTO patients (nome, setor, horario, status, prioridade, tipo_prioridade, tipo_atendimento, profissional, condicoes_especiais, etapa_fluxo, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP) RETURNING *`,
      [nome, setor, horario, 'aguardando', prioridade || 'geral', tipo_prioridade || null, tipo_atendimento || null, profissional || null, condicoes_especiais || null, etapa_fluxo || 'recepcao']
    );

    io.emit('queueUpdate');

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Patient status for QR Code
app.get('/api/patients/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    
    const pResult = await pool.query('SELECT * FROM patients WHERE id = $1', [id]);
    if (pResult.rows.length === 0) return res.status(404).json({ error: 'Paciente não encontrado' });
    const p = pResult.rows[0];
    
    if (p.status !== 'aguardando') {
      return res.json({ patient: p, position: 0 });
    }
    
    const queueResult = await pool.query(
      `SELECT id FROM patients 
       WHERE status = 'aguardando' AND setor = $1
       ORDER BY
         CASE WHEN prioridade = 'prioritario' THEN 0 ELSE 1 END ASC,
         COALESCE(sort_order, 2147483647) ASC,
         created_at AT TIME ZONE 'America/Sao_Paulo' ASC`,
      [p.setor]
    );
    
    const position = queueResult.rows.findIndex(row => row.id == id) + 1;
    res.json({ patient: p, position });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Call next patient
app.post('/api/call-next/:setor', async (req, res) => {
  const client = await pool.connect();
  try {
    const { setor } = req.params;
    const { medico, consultorio, profissional, filtro_profissional, filtro_etapa } = req.body || {};

    await client.query('BEGIN');

    // Get next waiting patient (priority first, then arrival order)
    // If filtro_profissional is set, only get patients assigned to that professional
    let nextQuery = `SELECT * FROM patients WHERE setor = $1 AND status = 'aguardando'`;
    const nextParams = [setor];
    if (filtro_profissional) {
      nextQuery += ` AND profissional = $2`;
      nextParams.push(filtro_profissional);
    }
    if (filtro_etapa && setor === 'Acolhimento') {
      nextQuery += ` AND etapa_fluxo = $${nextParams.length + 1}`;
      nextParams.push(filtro_etapa);
    }
    nextQuery += ` ORDER BY CASE WHEN prioridade = 'prioritario' THEN 0 ELSE 1 END ASC, COALESCE(sort_order, 2147483647) ASC, created_at AT TIME ZONE 'America/Sao_Paulo' ASC LIMIT 1`;
    const nextResult = await client.query(nextQuery, nextParams);

    if (nextResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Nenhum paciente aguardando' });
    }

    const next = nextResult.rows[0];

    const medicoFinal = medico || null;
    const consultorioFinal = consultorio || null;
    const profissionalFinal = profissional || null;

    // Update patient status and assign medico/consultorio/profissional
    await client.query(
      "UPDATE patients SET status = 'chamado', medico = $2, consultorio = $3, profissional = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
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

    await client.query('COMMIT');

    const updatedResult = await pool.query('SELECT * FROM patients WHERE id = $1', [next.id]);
    const nextPatient = updatedResult.rows[0];

    // Emite atualização imediata
    io.emit('queueUpdate');

    // Libera a requisição IMEDIATAMENTE
    res.json(nextPatient);

    // Emissão de evento para painéis em background
    setTimeout(() => {
      io.emit('callPatient', { patient: nextPatient, setor, audioUrl: null });
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
    const { setor, newPosition, senha } = req.body;

    if (senha !== ADMIN_PASSWORD) {
      return res.status(403).json({ error: 'Senha administrativa incorreta' });
    }
    if (!setor || !newPosition || isNaN(parseInt(newPosition))) {
      return res.status(400).json({ error: 'Setor e nova posição são obrigatórios' });
    }

    const pos = Math.max(1, parseInt(newPosition));

    await client.query('BEGIN');

    // Busca todos os pacientes aguardando neste setor em ordem atual
    const queueResult = await client.query(
      `SELECT id FROM patients
       WHERE setor = $1 AND status = 'aguardando'
       ORDER BY
         CASE WHEN prioridade = 'prioritario' THEN 0 ELSE 1 END ASC,
         COALESCE(sort_order, 2147483647) ASC,
         created_at AT TIME ZONE 'America/Sao_Paulo' ASC`,
      [setor]
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
    if (senha !== ADMIN_PASSWORD) {
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
    const { id } = req.params;
    const { novoSetor, novoTipoAtendimento, novoProfissional, senha } = req.body;

    if (senha !== ADMIN_PASSWORD) {
      return res.status(403).json({ error: 'Senha administrativa incorreta' });
    }
    if (!novoSetor || !SETORES.includes(novoSetor)) {
      return res.status(400).json({ error: 'Setor de destino inválido' });
    }

    await client.query('BEGIN');

    // Busca o paciente atual antes de mover (para log de histórico)
    const pResult = await client.query('SELECT * FROM patients WHERE id = $1', [id]);
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
    const tipo = novoTipoAtendimento || null;
    const prof = novoProfissional || null;

    // Calcular o sort_order para inserir na 3ª posição da fila destino
    // Se a fila de destino tiver < 2 pacientes aguardando, o paciente vai ao final.
    const filaResult = await client.query(
      `SELECT sort_order FROM patients
       WHERE setor = $1 AND status = 'aguardando'
       ORDER BY COALESCE(sort_order, 999999) ASC`,
      [novoSetor]
    );
    const filaDestino = filaResult.rows;

    let novoSortOrder = null; // NULL = vai para o final (default)
    if (filaDestino.length >= 2) {
      // Inserir após o 2º paciente (posição 3)
      const pos2SortOrder = filaDestino[1].sort_order;
      const pos3SortOrder = filaDestino.length >= 3 ? filaDestino[2].sort_order : null;

      if (pos2SortOrder !== null) {
        if (pos3SortOrder !== null) {
          // Interpolação entre pos 2 e pos 3
          novoSortOrder = pos2SortOrder + Math.floor((pos3SortOrder - pos2SortOrder) / 2);
          if (novoSortOrder <= pos2SortOrder) novoSortOrder = pos2SortOrder + 1;
        } else {
          novoSortOrder = pos2SortOrder + 1;
        }
      }
    }

    const result = await client.query(
      `UPDATE patients
       SET setor = $2, sort_order = $6, horario = $3,
           tipo_atendimento = $4, profissional = $5, origem_transferencia = $7,
           status = 'aguardando', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [id, novoSetor, novoHorario, tipo, prof, novoSortOrder, patientAntes.setor]
    );
    const patient = result.rows[0];

    // Registrar no histórico de chamadas (log de transferência)
    const horarioLog = new Date().toLocaleTimeString('pt-BR', {
      timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'
    });
    
    // O 'setor' recebe a origem para que os filtros do relatório funcionem.
    // O 'profissional' recebe a string de destino para aparecer no PDF.
    // Adicionamos um prefixo [Transf] no nome para evitar que toque no painel da TV de forma indesejada
    // ou se tocar, ficar claro. Mas o melhor é o painel ignorar.
    await client.query(
      `INSERT INTO call_history
         (patient_id, nome, setor, medico, horario_chamada, profissional, prioridade, tipo_prioridade)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        patient.id,
        patient.nome,
        patientAntes.setor, // Origem
        prof || null,       // Se houver um profissional destino específico
        horarioLog,
        `➡️ Encaminhado p/ ${novoSetor}`, // Aparece na coluna Profissional no PDF
        patient.prioridade || 'geral',
        patient.tipo_prioridade || null
      ]
    );

    await client.query('COMMIT');
    io.emit('queueUpdate');
    res.json({ message: `Paciente transferido para ${novoSetor} (3ª posição)`, patient });
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
    
    if (senha !== ADMIN_PASSWORD) {
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
      const prof = r.profissional || r.medico || 'Não especificado';
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
        "SELECT * FROM patients WHERE setor = $1 AND status = 'chamado'",
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
      bottleneckBySetor: bottleneckResult.rows
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
    
    if (senha !== ADMIN_PASSWORD) {
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
    if (senha !== ADMIN_PASSWORD) {
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
    // Busca status atual e inverte
    const current = await pool.query('SELECT status FROM ctrl_agendamentos WHERE id = $1', [id]);
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Registro não encontrado' });
    }
    const novoStatus = current.rows[0].status === 'pendente' ? 'agendado' : 'pendente';
    const result = await pool.query(
      `UPDATE ctrl_agendamentos
       SET status = $2, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING *`,
      [id, novoStatus]
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

// ====== FIM CTRL AGENDAMENTOS ======

// ====== MELHORIA 3: VAGAS MENSAIS POR MÉDICO ======

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
    // Cruza com ctrl_agendamentos usando o mês/ano do campo criado_em
    const usadosResult = await pool.query(
      `SELECT 
         CASE 
           WHEN equipe IN ('Eq 1 Chico Mendes', 'Equipe 1 Chico Mendes', 'Chico Mendes') THEN 'Dra. Anahy Duarte'
           WHEN equipe IN ('Eq 2 Ximboré', 'Equipe 2 Ximboré', 'Equipe 2 Ximbore', 'Ximboré', 'Ximbore') THEN 'Dr. Joene Halan'
           WHEN equipe IN ('Eq 3 Aurora', 'Equipe 3 Aurora', 'Aurora') THEN 'Dra. Mirela Mota'
           ELSE equipe
         END AS medico, 
         COUNT(*) AS usados
       FROM ctrl_agendamentos
       WHERE status = 'agendado'
         AND EXTRACT(MONTH FROM criado_em AT TIME ZONE 'America/Sao_Paulo') = $1
         AND EXTRACT(YEAR FROM criado_em AT TIME ZONE 'America/Sao_Paulo') = $2
       GROUP BY 
         CASE 
           WHEN equipe IN ('Eq 1 Chico Mendes', 'Equipe 1 Chico Mendes', 'Chico Mendes') THEN 'Dra. Anahy Duarte'
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
    const { nome, telefone, data_agendamento, horario, profissional, tipo_atendimento, template, observacoes, checklist_exames } = req.body;
    if (!nome || !telefone || !data_agendamento || !horario) {
      return res.status(400).json({ error: 'Nome, telefone, data e horário são obrigatórios' });
    }
    const result = await pool.query(
      `INSERT INTO agendamentos (nome, telefone, data_agendamento, horario, profissional, tipo_atendimento, template, observacoes, checklist_exames)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [nome, telefone, data_agendamento, horario, profissional || null, tipo_atendimento || null, template || 'lembrete', observacoes || null, checklist_exames || null]
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

// DELETE – excluir agendamento (admin)
app.post('/api/agendamentos/:id/delete', async (req, res) => {
  try {
    const { id } = req.params;
    const { senha } = req.body;
    if (senha !== ADMIN_PASSWORD) {
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
    if (senha !== ADMIN_PASSWORD) {
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
    if (senha !== ADMIN_PASSWORD) {
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
      `SELECT * FROM patients
       WHERE setor = 'Acolhimento' AND status NOT IN ('atendido', 'desistencia')
       ORDER BY
         CASE WHEN risco_clinico = 'vermelho' THEN 0 WHEN risco_clinico = 'amarelo' THEN 1 WHEN risco_clinico = 'verde' THEN 2 WHEN risco_clinico = 'azul' THEN 3 ELSE 2 END ASC,
         CASE WHEN prioridade = 'prioritario' THEN 0 ELSE 1 END ASC,
         created_at AT TIME ZONE 'America/Sao_Paulo' ASC`
    );
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
    const { queixa, risco_clinico, profissional_destino, tipo_profissional_destino, cpf, cartao_sus, condicoes_especiais } = req.body;
    if (!queixa) {
      return res.status(400).json({ error: 'Queixa é obrigatória' });
    }
    const result = await pool.query(
      `UPDATE patients SET etapa_fluxo = 'segunda_escuta', queixa = $2, risco_clinico = $3,
       profissional_destino = $4, tipo_profissional_destino = $5, cpf = $6, cartao_sus = $7, condicoes_especiais = COALESCE($8, condicoes_especiais), inicio_etapa = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND setor = 'Acolhimento' AND etapa_fluxo = 'primeira_escuta' RETURNING *`,
      [id, queixa, risco_clinico || 'verde', profissional_destino || null, tipo_profissional_destino || null, cpf || null, cartao_sus || null, condicoes_especiais || null]
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
        patient: { ...patient, medico: patient.profissional }, 
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

// POST chamar – Dispara chamado no painel sem mudar status
app.post('/api/acolhimento/:id/chamar', async (req, res) => {
  try {
    const { id } = req.params;
    const { destino } = req.body || {};
    const result = await pool.query('SELECT * FROM patients WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Paciente não encontrado' });
    const patient = result.rows[0];
    
    // Insere no histórico para o painel (TV) buscar via polling e tocar o áudio correto
    await pool.query(
      `INSERT INTO call_history (patient_id, nome, setor, medico, horario_chamada) VALUES ($1, $2, $3, $4, $5)`,
      [patient.id, patient.nome, 'Acolhimento', destino || '2ª Escuta', new Date().toLocaleTimeString('pt-BR', { hour12: false, hour: '2-digit', minute: '2-digit' })]
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
