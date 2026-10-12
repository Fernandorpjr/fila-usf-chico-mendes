-- Migração: Histórico de Agendamentos e Dispositivos Conectados
-- Idempotente (pode rodar múltiplas vezes sem quebrar)

-- 1. Colunas adicionais na tabela agendamentos
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS motivo_cancelamento TEXT;
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS data_original DATE;
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS horario_original TEXT;
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS cancelado_em TIMESTAMPTZ;
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS reagendado_em TIMESTAMPTZ;
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS cancelado_por TEXT;
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS arquivado BOOLEAN DEFAULT false;
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS equipe TEXT;

-- 2. Tabela agendamento_historico
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
);

ALTER TABLE agendamento_historico ADD COLUMN IF NOT EXISTS dispositivo_id UUID;
ALTER TABLE agendamento_historico ADD COLUMN IF NOT EXISTS usuario TEXT;
ALTER TABLE agendamento_historico ADD COLUMN IF NOT EXISTS arquivado BOOLEAN DEFAULT false;
ALTER TABLE agendamento_historico ADD COLUMN IF NOT EXISTS arquivado_em TIMESTAMPTZ;
ALTER TABLE agendamento_historico ADD COLUMN IF NOT EXISTS vaga_reaproveitada BOOLEAN DEFAULT false;

-- 3. Tabela dispositivos
CREATE TABLE IF NOT EXISTS dispositivos (
  id UUID PRIMARY KEY,
  nome TEXT DEFAULT 'Sem nome',
  setor TEXT,
  ultimo_ip TEXT,
  user_agent TEXT,
  primeiro_acesso TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  ultimo_acesso TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  ativo BOOLEAN DEFAULT true
);

-- 4. Tabela dispositivo_acessos (histórico de login / primeiros acessos diários)
CREATE TABLE IF NOT EXISTS dispositivo_acessos (
  id SERIAL PRIMARY KEY,
  dispositivo_id UUID REFERENCES dispositivos(id) ON DELETE CASCADE,
  ip TEXT,
  user_agent TEXT,
  tipo TEXT DEFAULT 'login',
  criado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 5. Tabela configuracoes
CREATE TABLE IF NOT EXISTS configuracoes (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

INSERT INTO configuracoes (chave, valor)
VALUES ('historico_retencao_dias', '30')
ON CONFLICT (chave) DO NOTHING;

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_agendamento_historico_criado_em ON agendamento_historico(criado_em);
CREATE INDEX IF NOT EXISTS idx_agendamento_historico_data_ant ON agendamento_historico(data_anterior);
CREATE INDEX IF NOT EXISTS idx_agendamento_historico_nova_data ON agendamento_historico(nova_data);
CREATE INDEX IF NOT EXISTS idx_agendamento_historico_disp ON agendamento_historico(dispositivo_id);
CREATE INDEX IF NOT EXISTS idx_dispositivos_ultimo_acesso ON dispositivos(ultimo_acesso);
CREATE INDEX IF NOT EXISTS idx_disp_acessos_disp_data ON dispositivo_acessos(dispositivo_id, criado_em);
