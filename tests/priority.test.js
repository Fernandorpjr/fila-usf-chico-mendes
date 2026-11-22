const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SETORES_HORARIO_MARCADO,
  normalizarHorarioMarcado,
  calcularOrdemPrioridadeOdonto,
  sortQueueRows,
  deduplicarAtendimentosPorSetor,
  isPacienteIntercorrenciaClinica,
  agruparEtapaAcolhimento,
  resolverEstadoTransferenciaAcolhimento
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

test('deduplicarAtendimentosPorSetor ignores rechamar/transfers and counts once per sector', () => {
  const records = [
    { id: 10, patient_id: 1, nome: 'Maria', setor: 'Médico', profissional: '🔊 Rechamar · Dr. Israel' },
    { id: 9, patient_id: 1, nome: 'Maria', setor: 'Médico', profissional: '➡️ Encaminhado p/ Farmácia' },
    { id: 8, patient_id: 1, nome: 'Maria', setor: 'Farmácia', profissional: 'Leandra' },
    { id: 7, patient_id: 1, nome: 'Maria', setor: 'Médico', profissional: 'Dr. Israel' },
    { id: 6, patient_id: 1, nome: 'Maria', setor: 'Acolhimento', profissional: 'Ana Paula' }
  ];
  const dedup = deduplicarAtendimentosPorSetor(records);
  assert.equal(dedup.length, 3);
  assert.deepEqual(dedup.map(r => r.setor), ['Farmácia', 'Médico', 'Acolhimento']);
});

test('isPacienteIntercorrenciaClinica counts only explicit intercorrencia/acolhimento intercorrencia', () => {
  assert.equal(isPacienteIntercorrenciaClinica({ horario_marcado: '09:00', tipo_atendimento: 'Consulta' }), false);
  assert.equal(isPacienteIntercorrenciaClinica({ horario_marcado: null, tipo_atendimento: 'Consulta Agendada (Conecta Recife)' }), false);
  assert.equal(isPacienteIntercorrenciaClinica({ horario_marcado: null, tipo_atendimento: 'Consulta' }), false);
  assert.equal(isPacienteIntercorrenciaClinica({ horario_marcado: '10:00', tipo_atendimento: 'Urgência' }), false);
  assert.equal(isPacienteIntercorrenciaClinica({ horario_marcado: '09:00', is_intercorrencia_acolhimento: true }), true);
  assert.equal(isPacienteIntercorrenciaClinica({ horario_marcado: null, tipo_atendimento: 'Intercorrência' }), true);
  assert.equal(isPacienteIntercorrenciaClinica({ horario_marcado: null, tipo_atendimento: 'Intercorrência (Acolhimento)' }), true);
});

test('Transferencia para Acolhimento reseta etapa_fluxo para recepcao e recupera etapas orfas', () => {
  // Caso real: paciente veio do Acolhimento -> Enfermagem ('encaminhado_intercorrencia') -> volta ao Acolhimento
  const estadoRetornoAcol = resolverEstadoTransferenciaAcolhimento(
    { setor: 'Enfermagem', etapa_fluxo: 'encaminhado_intercorrencia', is_intercorrencia_acolhimento: true },
    'Acolhimento',
    false
  );
  assert.deepEqual(estadoRetornoAcol, {
    indoParaAcolhimento: true,
    veioDoAcolhimento: false,
    isIntercFinal: false,
    novaEtapaFluxo: 'recepcao',
    limparCamposAcolhimento: true
  });

  // Fluxo normal de Acolhimento -> Médico preserva marcação de intercorrência
  const estadoSaidaAcol = resolverEstadoTransferenciaAcolhimento(
    { setor: 'Acolhimento', etapa_fluxo: 'primeira_escuta', is_intercorrencia_acolhimento: false },
    'Médico',
    false
  );
  assert.equal(estadoSaidaAcol.indoParaAcolhimento, false);
  assert.equal(estadoSaidaAcol.veioDoAcolhimento, true);
  assert.equal(estadoSaidaAcol.isIntercFinal, true);
  assert.equal(estadoSaidaAcol.novaEtapaFluxo, 'encaminhado_intercorrencia');
  assert.equal(estadoSaidaAcol.limparCamposAcolhimento, false);

  // Agrupamento defensivo do fluxo do Acolhimento nunca deixa paciente ativo sumir
  assert.equal(agruparEtapaAcolhimento('recepcao'), 'recepcao');
  assert.equal(agruparEtapaAcolhimento('primeira_escuta'), 'primeira_escuta');
  assert.equal(agruparEtapaAcolhimento('segunda_escuta'), 'segunda_escuta');
  assert.equal(agruparEtapaAcolhimento('encaminhado_intercorrencia'), 'recepcao');
  assert.equal(agruparEtapaAcolhimento('finalizado'), 'recepcao');
  assert.equal(agruparEtapaAcolhimento(null), 'recepcao');
});
