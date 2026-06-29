const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    const res = await pool.query("SELECT id FROM patients WHERE setor='Acolhimento' ORDER BY id DESC LIMIT 1");
    if (res.rows.length) {
      console.log('ID:', res.rows[0].id);
      
      const r2 = await fetch(`http://localhost:3000/api/acolhimento/${res.rows[0].id}/chamar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destino: '2ª Escuta (via 1ª Escuta)' })
      });
      console.log('Status:', r2.status);
      const text = await r2.text();
      console.log('Response:', text);
    }
  } catch(e) {
    console.error(e);
  }
  process.exit(0);
}
run();
