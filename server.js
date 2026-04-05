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

io.on('connection', (socket) => {
  console.log('Device connected to WebSocket');
});

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
    const { nome, setor, prioridade, tipo_prioridade, tipo_atendimento, profissional } = req.body;

    if (!nome || !setor) {
      return res.status(400).json({ error: 'Nome e setor são obrigatórios' });
    }

    const horario = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

    const result = await pool.query(
      `INSERT INTO patients (nome, setor, horario, status, prioridade, tipo_prioridade, tipo_atendimento, profissional, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP) RETURNING *`,
      [nome, setor, horario, 'aguardando', prioridade || 'geral', tipo_prioridade || null, tipo_atendimento || null, profissional || null]
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
    const todayFilter = `DATE(created_at AT TIME ZONE 'America/Sao_Paulo') = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date`;
    
    // Attended today by sector
    const attendedResult = await pool.query(
      `SELECT COUNT(*) as total, setor FROM call_history WHERE ${todayFilter} GROUP BY setor`
    );
    
    // Desistencias today
    const desistResult = await pool.query(
      `SELECT COUNT(*) as total FROM patients WHERE status = 'desistencia' AND ${todayFilter}`
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
       WHERE DATE(ch.created_at AT TIME ZONE 'America/Sao_Paulo') = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
       GROUP BY ch.setor`
    );
    
    // Bottleneck (waiting > 30 min) – ensure comparisons use same domain
    const bottleneckResult = await pool.query(
      `SELECT COUNT(*) as total, setor FROM patients
       WHERE status = 'aguardando'
       AND created_at < NOW() AT TIME ZONE 'America/Sao_Paulo' - INTERVAL '30 minutes'
       GROUP BY setor`
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
    const todayFilter = `DATE(created_at AT TIME ZONE 'America/Sao_Paulo') = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date`;
    
    const entriesResult = await pool.query(
      `SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo') as hour, COUNT(*) as total
       FROM patients WHERE ${todayFilter}
       GROUP BY hour
       ORDER BY hour`
    );
    
    const callsResult = await pool.query(
      `SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo') as hour, COUNT(*) as total
       FROM call_history WHERE ${todayFilter}
       GROUP BY hour
       ORDER BY hour`
    );
    
    const desistResult = await pool.query(
      `SELECT EXTRACT(HOUR FROM updated_at AT TIME ZONE 'America/Sao_Paulo') as hour, COUNT(*) as total
       FROM patients WHERE status = 'desistencia' AND DATE(updated_at AT TIME ZONE 'America/Sao_Paulo') = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
       GROUP BY hour
       ORDER BY hour`
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

// DELETE – excluir agendamento (admin)
app.delete('/api/agendamentos/:id', async (req, res) => {
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
});
