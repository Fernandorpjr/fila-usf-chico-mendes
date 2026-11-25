-- Migração aditiva segura — Bloco 3 (Rotina da Unidade: Auditoria, Ausência Temporária, Tubos de Coleta e Check-in de Agendamentos)
-- Executada também de forma idempotente em garantirColunasEscuta() no server.js.

ALTER TABLE patients ADD COLUMN IF NOT EXISTS exames_coleta JSONB DEFAULT NULL;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS ausente_temporario BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS patient_fila_id INTEGER DEFAULT NULL;

CREATE TABLE IF NOT EXISTS log_auditoria_fila (
  id SERIAL PRIMARY KEY,
  paciente_id INT REFERENCES patients(id) ON DELETE SET NULL,
  acao VARCHAR(50) NOT NULL,
  setor VARCHAR(60),
  valor_anterior TEXT,
  valor_novo TEXT,
  motivo TEXT,
  perfil_usuario VARCHAR(30),
  usuario_dispositivo VARCHAR(80),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_log_auditoria_fila_data ON log_auditoria_fila(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_log_auditoria_fila_paciente ON log_auditoria_fila(paciente_id);
