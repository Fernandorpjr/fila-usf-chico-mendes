const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calcularDataVencimento,
  calcularDiasRestantes,
  classificarUrgencia,
  classificarReceita
} = require('../lib/receitas');

test('calcularDataVencimento adds 2 or 6 months cleanly', () => {
  assert.equal(calcularDataVencimento('10/01/2026', 6), '10/07/2026');
  assert.equal(calcularDataVencimento('10/10/2026', 2), '10/12/2026');
  assert.equal(calcularDataVencimento('invalid', 6), null);
});

test('classificarUrgencia classifies expired, urgent <=7d, and normal', () => {
  assert.equal(classificarUrgencia(-1), 'vencida');
  assert.equal(classificarUrgencia(0), 'urgente');
  assert.equal(classificarUrgencia(7), 'urgente');
  assert.equal(classificarUrgencia(8), 'normal');
  assert.equal(classificarUrgencia(null), 'normal');
});

test('classificarReceita routes azul to Medico (2 months)', () => {
  const r = classificarReceita('azul', 'Clonazepam 2mg', '10/08/2026', new Date('2026-11-20T12:00:00Z'));
  assert.equal(r.fila_destino, 'Médico');
  assert.equal(r.validade_meses, 2);
  assert.equal(r.data_vencimento, '10/10/2026');
  assert.equal(r.urgencia, 'vencida');
});

test('classificarReceita routes Hiperdia branca allowed meds to Enfermagem (6 months)', () => {
  const r = classificarReceita('branca', 'Losartana 50mg, Metformina 850mg, Hidroclorotiazida 25mg', '20/10/2026', new Date('2026-11-20T12:00:00Z'));
  assert.equal(r.fila_destino, 'Enfermagem');
  assert.equal(r.validade_meses, 6);
  assert.equal(r.data_vencimento, '20/04/2027');
  assert.equal(r.urgencia, 'normal');
});

test('classificarReceita routes branca with Sinvastatina or unknown med to Medico', () => {
  const rSinv = classificarReceita('branca', 'Losartana 50mg, Sinvastatina 20mg', '20/10/2026', new Date('2026-11-20T12:00:00Z'));
  assert.equal(rSinv.fila_destino, 'Médico');

  const rUnk = classificarReceita('branca', 'Medicamento Xpto 10mg', '20/10/2026', new Date('2026-11-20T12:00:00Z'));
  assert.equal(rUnk.fila_destino, 'Médico');
  assert.equal(rUnk.medicamento_desconhecido, true);
});

test('calcularDiasRestantes computes day difference properly', () => {
  const dias = calcularDiasRestantes('25/11/2026', new Date('2026-11-20T13:00:00Z'));
  assert.equal(dias, 5);
});
