if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (e) {}
}
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const googleTTS = require('google-tts-api');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

io.on('connection', (socket) => {
  console.log('Device connected to WebSocket');
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Database setup
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS call_history (
        id SERIAL PRIMARY KEY,
        patient_id INTEGER,
        nome TEXT NOT NULL,
        setor TEXT NOT NULL,
        horario_chamada TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Add medico column to existing tables (safe schema update)
    await pool.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS medico TEXT`);
    await pool.query(`ALTER TABLE call_history ADD COLUMN IF NOT EXISTS medico TEXT`);

    console.log('✅ Banco de dados inicializado com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao inicializar banco de dados:', error.message);
  }
}

initDB();

// API Routes

// Get all queues
app.get('/api/queues', async (req, res) => {
  try {
    const queues = {
      'Acolhimento': [],
      'Farmácia': [],
      'Regulação': [],
      'Consulta': [],
      'Renovação de Receita': []
    };

    const result = await pool.query(
      "SELECT * FROM patients WHERE status != $1 ORDER BY created_at ASC",
      ['atendido']
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
    const { nome, setor } = req.body;

    if (!nome || !setor) {
      return res.status(400).json({ error: 'Nome e setor são obrigatórios' });
    }

    const horario = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const result = await pool.query(
      'INSERT INTO patients (nome, setor, horario, status) VALUES ($1, $2, $3, $4) RETURNING *',
      [nome, setor, horario, 'aguardando']
    );

    io.emit('queueUpdate');

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Call next patient
app.post('/api/call-next/:setor', async (req, res) => {
  const client = await pool.connect();
  try {
    const { setor } = req.params;
    const { medico } = req.body || {}; // Optional doctor/room name

    await client.query('BEGIN');

    // Get next waiting patient
    const nextResult = await client.query(
      "SELECT * FROM patients WHERE setor = $1 AND status = 'aguardando' ORDER BY created_at ASC LIMIT 1",
      [setor]
    );

    if (nextResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Nenhum paciente aguardando' });
    }

    const next = nextResult.rows[0];

    // Update patient status and assign medico
    await client.query("UPDATE patients SET status = 'chamado', medico = $2 WHERE id = $1", [next.id, medico || null]);

    // Mark previous called as atendido
    await client.query(
      "UPDATE patients SET status = 'atendido' WHERE setor = $1 AND status = 'chamado' AND id != $2",
      [setor, next.id]
    );

    // Add to history
    const horarioChamada = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    await client.query(
      'INSERT INTO call_history (patient_id, nome, setor, horario_chamada, medico) VALUES ($1, $2, $3, $4, $5)',
      [next.id, next.nome, setor, horarioChamada, medico || null]
    );

    await client.query('COMMIT');

    const updatedResult = await pool.query('SELECT * FROM patients WHERE id = $1', [next.id]);
    const nextPatient = updatedResult.rows[0];

    // Emite atualização imediata para alterar as filas visualmente para todos os operadores
    io.emit('queueUpdate');

    // Libera a requisição do médico IMEDIATAMENTE (Zera o delay na interface)
    res.json(nextPatient);

    // Geração de áudio e emissão do painel rodam em background
    setTimeout(() => {
      // Emite evento para todos os painéis e atualiza as filas globalmente
      // (audioUrl removido — o frontend utilizará vozes nativas Neural do SO)
      io.emit('callPatient', { patient: nextPatient, setor, audioUrl: null });
    }, 100);

  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Get call history (full, no limit)
app.get('/api/history', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM call_history ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get attended patients list
app.get('/api/attended', async (req, res) => {
  try {
    // Busca do call_history garante que TODOS os pacientes já chamados apareçam (mesmo os que ainda estão na mesa do médico)
    const result = await pool.query(
      "SELECT * FROM call_history ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get current calling
app.get('/api/current-calling', async (req, res) => {
  try {
    const current = {
      'Acolhimento': null,
      'Farmácia': null,
      'Regulação': null,
      'Consulta': null,
      'Renovação de Receita': null
    };

    for (const setor of Object.keys(current)) {
      const result = await pool.query(
        "SELECT * FROM patients WHERE setor = $1 AND status = 'chamado'",
        [setor]
      );
      if (result.rows.length > 0) current[setor] = result.rows[0];
    }

    // Calcular o total de atendidos hoje (assumindo que o histórico é limpo diariamente)
    const countResult = await pool.query("SELECT COUNT(*) FROM call_history");
    const totalAtendidos = parseInt(countResult.rows[0].count, 10);

    res.json({ current, totalAtendidos });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reset database (optional utility)
app.post('/api/reset', async (req, res) => {
  try {
    // Delete data securely and restart sequences to reset IDs to 1
    await pool.query('DELETE FROM call_history');
    await pool.query('DELETE FROM patients');
    await pool.query('ALTER SEQUENCE patients_id_seq RESTART WITH 1');
    await pool.query('ALTER SEQUENCE call_history_id_seq RESTART WITH 1');
    
    io.emit('queueUpdate');
    
    res.json({ message: 'Banco de dados resetado com sucesso' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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
