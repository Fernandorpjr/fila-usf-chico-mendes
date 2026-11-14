const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SETORES_HORARIO_MARCADO,
  normalizarHorarioMarcado,
  calcularOrdemPrioridadeOdonto,
  sortQueueRows
} = require('../lib/prioridade');

test('normalizarHorarioMarcado formats HH:MM cleanly', () => {
  assert.equal(normalizarHorarioMarcado('9:5'), '09:05');
  assert.equal(normalizarHorarioMarcado('14:30'), '14:30');
  assert.equal(normalizarHorarioMarcado('  '), null);
  assert.equal(normalizarHorarioMarcado(null), null);
});

test('calcularOrdemPrioridadeOdonto respects strict 1 to 10 hierarchy', () => {
  assert.equal(calcularOrdemPrioridadeOdonto(82, 'geral', null, null).ordem_prioridade_odonto, 1);
  assert.equal(calcularOrdemPrioridadeOdonto(null, 'prioritario', '2. Pessoa com Deficiência (PCD)', null).ordem_prioridade_odonto, 2);
  assert.equal(calcularOrdemPrioridadeOdonto(null, 'prioritario', '3. Pessoa com TEA', null).ordem_prioridade_odonto, 3);
  assert.equal(calcularOrdemPrioridadeOdonto(null, 'prioritario', '4. Gestante', null).ordem_prioridade_odonto, 4);
  assert.equal(calcularOrdemPrioridadeOdonto(null, 'prioritario', '5. Lactante', null).ordem_prioridade_odonto, 5);
  assert.equal(calcularOrdemPrioridadeOdonto(null, 'prioritario', '6. Criança de Colo (< 2 anos)', null).ordem_prioridade_odonto, 6);
  assert.equal(calcularOrdemPrioridadeOdonto(null, 'prioritario', '7. Mobilidade Reduzida', null).ordem_prioridade_odonto, 7);
  assert.equal(calcularOrdemPrioridadeOdonto(null, 'prioritario', '8. Obesidade', null).ordem_prioridade_odonto, 8);
  assert.equal(calcularOrdemPrioridadeOdonto(65, 'geral', null, null).ordem_prioridade_odonto, 9);
  assert.equal(calcularOrdemPrioridadeOdonto(null, 'prioritario', '10. Doador de Sangue', null).ordem_prioridade_odonto, 10);
  assert.equal(calcularOrdemPrioridadeOdonto(30, 'geral', null, null).ordem_prioridade_odonto, 99);
});

test('sortQueueRows uses Horario Marcado for Medico/Odontologia/Enfermagem', () => {
  for (const setor of SETORES_HORARIO_MARCADO) {
    const sorted = sortQueueRows([
      { id: 1, nome: 'Carlos', prioridade: 'geral', horario_marcado: '10:00', created_at: '2026-11-14T07:00:00Z' },
      { id: 2, nome: 'Andreia', prioridade: 'geral', horario_marcado: '09:00', created_at: '2026-11-14T09:20:00Z' },
      { id: 3, nome: 'Fernando', prioridade: 'geral', horario_marcado: '09:00', created_at: '2026-11-14T09:00:00Z' },
      { id: 4, nome: 'Dona Maria', prioridade: 'prioritario', tipo_prioridade: '1. Idoso 80+ (Prioridade Especial)', horario_marcado: '11:00', created_at: '2026-11-14T10:00:00Z' }
    ], setor);
    assert.deepEqual(sorted.map(r => r.nome), ['Dona Maria', 'Fernando', 'Andreia', 'Carlos']);
  }
});

test('sortQueueRows ignores Horario Marcado for spontaneous demand sectors', () => {
  const sorted = sortQueueRows([
    { id: 1, nome: 'Chegou Primeiro', prioridade: 'geral', horario_marcado: '11:00', created_at: '2026-11-14T07:00:00Z' },
    { id: 2, nome: 'Chegou Depois', prioridade: 'geral', horario_marcado: '08:00', created_at: '2026-11-14T08:00:00Z' },
    { id: 3, nome: 'Gestante', prioridade: 'prioritario', tipo_prioridade: '4. Gestante', created_at: '2026-11-14T09:00:00Z' }
  ], 'Farmácia');
  assert.deepEqual(sorted.map(r => r.nome), ['Gestante', 'Chegou Primeiro', 'Chegou Depois']);
});
