// @ts-nocheck
if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (e) {}
}
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

/* === MELHORIA C: PRESENÇA ONLINE VIA SOCKET === */
io.on('connection', (socket) => {
  console.log('Device connected to WebSocket');
  io.emit('activeUsers', io.engine.clientsCount);

  // Track setor presence
  socket.on('registerPresenca', async (data) => {
    if (data && data.setor) {
      socket.presencaSetor = data.setor;
      try {
        await pool.query(
          `INSERT INTO chat_presenca (setor, last_seen) VALUES ($1, CURRENT_TIMESTAMP)
           ON CONFLICT (setor) DO UPDATE SET last_seen = CURRENT_TIMESTAMP`,
          [data.setor]
        );
      } catch(e) { console.error('Presença error:', e.message); }
    }
  });

  socket.on('disconnect', async () => {
    io.emit('activeUsers', io.engine.clientsCount);
    // Mark setor as offline on disconnect (optional — last_seen already tracks)
  });
});
/* === FIM MELHORIA C: PRESENÇA === */

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = '0177';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Database setup
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Setores válidos
const SETORES = ['Acolhimento', 'Farmácia', 'Regulação', 'Médico', 'Enfermagem', 'Odontologia'];

// Canais de chat válidos
const CANAIS_CHAT = ['geral', 'acolhimento', 'farmacia', 'regulacao', 'medico', 'enfermagem', 'odontologia', 'gerencia'];

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

    // Chat avançado com canais
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_channels (
        id SERIAL PRIMARY KEY,
        canal TEXT NOT NULL,
        autor TEXT NOT NULL,
        texto TEXT NOT NULL,
        urgente BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

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
    const { nome, setor, prioridade, tipo_prioridade, tipo_atendimento, profissional, condicoes_especiais } = req.body;

    if (!nome || !setor) {
      return res.status(400).json({ error: 'Nome e setor são obrigatórios' });
    }

    const horario = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

    const result = await pool.query(
      `INSERT INTO patients (nome, setor, horario, status, prioridade, tipo_prioridade, tipo_atendimento, profissional, condicoes_especiais, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP) RETURNING *`,
      [nome, setor, horario, 'aguardando', prioridade || 'geral', tipo_prioridade || null, tipo_atendimento || null, profissional || null, condicoes_especiais || null]
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
    const { medico, consultorio, profissional, filtro_profissional } = req.body || {};

    await client.query('BEGIN');

    // Get next waiting patient (priority first, then arrival order)
    // If filtro_profissional is set, only get patients assigned to that professional
    let nextQuery = `SELECT * FROM patients WHERE setor = $1 AND status = 'aguardando'`;
    const nextParams = [setor];
    if (filtro_profissional) {
      nextQuery += ` AND profissional = $2`;
      nextParams.push(filtro_profissional);
    }
    nextQuery += ` ORDER BY CASE WHEN prioridade = 'prioritario' THEN 0 ELSE 1 END ASC, created_at AT TIME ZONE 'America/Sao_Paulo' ASC LIMIT 1`;
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
      'SELECT * FROM chat_channels WHERE canal = $1 ORDER BY created_at ASC LIMIT 100',
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
    const { autor, texto, urgente } = req.body;
    if (!autor || !texto) {
      console.error(`❌ Chat error [${canal}]: Autor or texto missing`);
      return res.status(400).json({ error: 'Autor e texto são obrigatórios' });
    }
    const result = await pool.query(
      'INSERT INTO chat_channels (canal, autor, texto, urgente) VALUES ($1, $2, $3, $4) RETURNING *',
      [canal, autor, texto, urgente || false]
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

// ====== AGENDAMENTOS ======

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
    const result = await pool.query('SELECT * FROM patients WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Paciente não encontrado' });
    const patient = result.rows[0];
    
    // Formata o profissional para aparecer no painel
    const displayPatient = { 
      ...patient, 
      medico: patient.profissional_destino ? `2ª Escuta (${patient.profissional_destino})` : '2ª Escuta' 
    };

    io.emit('callPatient', { patient: displayPatient, setor: 'Acolhimento', audioUrl: null });
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
    const horarioChamada = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    await client.query(
      `INSERT INTO call_history (patient_id, nome, setor, horario_chamada, prioridade, tipo_prioridade, profissional, cpf, cartao_sus, acs_responsavel, agendamento_realizado, condicoes_especiais, queixa, risco_clinico)
       VALUES ($1, $2, 'Acolhimento', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [patient.id, patient.nome, horarioChamada, patient.prioridade, patient.tipo_prioridade, patient.profissional_destino, patient.cpf, patient.cartao_sus, patient.acs_responsavel, patient.agendamento_realizado, patient.condicoes_especiais, patient.queixa, patient.risco_clinico]
    );
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
    const horarioChamada = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    await client.query(
      `INSERT INTO call_history (patient_id, nome, setor, horario_chamada, prioridade, tipo_prioridade, profissional, cpf, cartao_sus, acs_responsavel, gravidade_final, agendamento_realizado, condicoes_especiais, queixa, risco_clinico)
       VALUES ($1, $2, 'Acolhimento', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [patient.id, patient.nome, horarioChamada, patient.prioridade, patient.tipo_prioridade, patient.profissional_destino, patient.cpf, patient.cartao_sus, patient.acs_responsavel, patient.gravidade_final, patient.agendamento_realizado, patient.condicoes_especiais, patient.queixa, patient.risco_clinico]
    );
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
server.listen(PORT, async () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Database: PostgreSQL (Neon)`);
  try {
    await initDB();
    console.log(`✅ Base de dados pronta!`);
  } catch (e) {
    console.error(`❌ Falha ao inicializar o banco de dados:`, e.message);
  }
});
