const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');

function extractSlice(src, startMarker, endMarker) {
  const i1 = src.indexOf(startMarker);
  const i2 = endMarker ? src.indexOf(endMarker, i1) : src.length;
  assert.ok(i1 >= 0, `Start marker missing: ${startMarker}`);
  assert.ok(i2 > i1, `End marker missing: ${endMarker}`);
  return src.slice(i1, i2);
}

test('Backend: registra entrada/saída automática no atendimento, ignora ausentes no Chamar Próximo e fixa ausente até retornar', () => {
  // Colunas de entrada, saída, duração e ausência
  assert.equal(serverSrc.includes('ALTER TABLE patients ADD COLUMN IF NOT EXISTS chamado_em TIMESTAMPTZ'), true);
  assert.equal(serverSrc.includes('ALTER TABLE patients ADD COLUMN IF NOT EXISTS finalizado_em TIMESTAMPTZ'), true);
  assert.equal(serverSrc.includes('ALTER TABLE patients ADD COLUMN IF NOT EXISTS ausente_desde TIMESTAMPTZ'), true);
  assert.equal(serverSrc.includes('ALTER TABLE call_history ADD COLUMN IF NOT EXISTS finalizado_em TIMESTAMPTZ'), true);
  assert.equal(serverSrc.includes('ALTER TABLE call_history ADD COLUMN IF NOT EXISTS duracao_atendimento_seg INTEGER'), true);

  // Chamar próximo ignora ausentes e fecha atendimento anterior automaticamente
  const callNextSlice = extractSlice(serverSrc, "app.post('/api/call-next/:setor'", "app.post('/api/patients/:id/rechamar'");
  assert.equal(callNextSlice.includes('COALESCE(ausente_temporario, false) = false'), true);
  assert.equal(callNextSlice.includes('chamado_em = CURRENT_TIMESTAMP'), true);
  assert.equal(callNextSlice.includes('finalizado_em = CURRENT_TIMESTAMP'), true);
  assert.equal(callNextSlice.includes('fecharAtendimentoAnteriorNoHistorico'), true);

  // Ausente aceita aguardando e chamado e fixa até retornar + nova rota retornar-ausente
  const ausenteSlice = extractSlice(serverSrc, "app.put('/api/patients/:id/ausente-temporario'", "app.put('/api/patients/:id/retornar-ausente'");
  assert.equal(ausenteSlice.includes("p.status !== 'chamado' && p.status !== 'aguardando'"), true);
  assert.equal(ausenteSlice.includes('ausente_desde = CURRENT_TIMESTAMP'), true);
  assert.equal(ausenteSlice.includes('FROM unnest($1::int[], $2::int[])'), true);

  const retornoSlice = extractSlice(serverSrc, "app.put('/api/patients/:id/retornar-ausente'", "app.get('/api/admin/auditoria-fila'");
  assert.equal(retornoSlice.includes('ausente_temporario = false'), true);
  assert.equal(retornoSlice.includes('ausente_desde = NULL'), true);
  assert.equal(retornoSlice.includes('ids.unshift(p.id)'), true);
});

test('Frontend Resumo do Dia: calcula Tempo Médio automático de atendimento (sem tempo de espera e sem botão extra)', () => {
  assert.equal(indexHtml.includes('grid-template-columns: repeat(6, minmax(0, 1fr))'), true);
  assert.equal(appSrc.includes('⏱️ Tempo Médio'), true);
  assert.equal(appSrc.includes('Saiu / Finalizar'), false);

  const tmSlice = extractSlice(
    appSrc,
    'function isRegistroRechamadaOuEncaminhamento(rec)',
    'function calcularResumoProfissionalDia('
  );

  const ctx = {
    callHistory: [
      // Atendimento 1 do Dr. Israel (12 min)
      { setor: 'Médico', profissional: 'Dr. Israel Christian', duracao_atendimento_seg: 720, created_at: '2026-11-28T08:00:00Z' },
      // Atendimento 2 do Dr. Israel (18 min)
      { setor: 'Médico', profissional: 'Dr. Israel Christian', duracao_atendimento_seg: 1080, created_at: '2026-11-28T08:12:00Z' },
      // Outlier clique acidental (20s -> ignorado) e almoço aberto (3h -> ignorado)
      { setor: 'Médico', profissional: 'Dr. Israel Christian', duracao_atendimento_seg: 20, created_at: '2026-11-28T08:30:00Z' },
      { setor: 'Médico', profissional: 'Dr. Israel Christian', duracao_atendimento_seg: 10800, created_at: '2026-11-28T11:30:00Z' },
      // Rechamada -> ignorada
      { setor: 'Médico', profissional: '🔊 Rechamar · Dr. Israel Christian', duracao_atendimento_seg: 900, created_at: '2026-11-28T08:40:00Z' },
      // Outro profissional (10 min)
      { setor: 'Médico', profissional: 'Dra. Mirela Mota', duracao_atendimento_seg: 600, created_at: '2026-11-28T08:05:00Z' },
      // Odontologia (20 min via finalizado_em)
      { setor: 'Odontologia', profissional: 'Dra. Juliana Cavalcante', created_at: '2026-11-28T09:00:00Z', finalizado_em: '2026-11-28T09:20:00Z' }
    ]
  };
  vm.runInNewContext(tmSlice, ctx);

  const tmIsrael = ctx.calcularTempoMedioAtendimento('Médico', 'Dr. Israel Christian');
  assert.equal(tmIsrael.qtd, 2);
  assert.equal(tmIsrael.mediaMin, 15);
  assert.equal(tmIsrael.minMin, 12);
  assert.equal(tmIsrael.maxMin, 18);
  assert.equal(tmIsrael.formatado, '15 min');

  const tmMedicoGeral = ctx.calcularTempoMedioAtendimento('Médico', null);
  assert.equal(tmMedicoGeral.qtd, 3);
  assert.equal(tmMedicoGeral.mediaMin, 13); // (12 + 18 + 10) / 3 = 13.33 -> 13 min

  const tmOdonto = ctx.calcularTempoMedioAtendimento('Odontologia', null);
  assert.equal(tmOdonto.qtd, 1);
  assert.equal(tmOdonto.mediaMin, 20);
});

test('Frontend Fila: botão Ausente disponível para aguardando/chamado, painel fixado no topo e botões organizados em 2 níveis', () => {
  assert.equal(indexHtml.includes('.fila-ausentes-box'), true);
  assert.equal(indexHtml.includes('.fila-actions-primary'), true);
  assert.equal(indexHtml.includes('.fila-actions-secondary'), true);
  assert.equal(indexHtml.includes('id="ctx-item-ausente"'), true);
  assert.equal(indexHtml.includes('id="ctx-item-qr"'), true);
  assert.equal(indexHtml.includes('id="ctx-item-radar"'), true);

  assert.equal(appSrc.includes('function renderBlocoAusentesFixados('), true);
  assert.equal(appSrc.includes('Ausentes Aguardando Retorno'), true);
  assert.equal(appSrc.includes('↩️ Voltou p/ Fila'), true);
  assert.equal(appSrc.includes('async function retornarAusenteParaFila('), true);

  const renderQueueSlice = extractSlice(appSrc, 'function renderQueueItems(', 'function updateQueues()');
  assert.equal(renderQueueSlice.includes('ausentesFixados'), true);
  assert.equal(renderQueueSlice.includes('ativosFila'), true);
  assert.equal(renderQueueSlice.includes('fila-actions-primary'), true);
  assert.equal(renderQueueSlice.includes('fila-actions-secondary'), true);
  // Botão Ausente não fica mais restrito apenas a p.status === 'chamado'
  assert.equal(renderQueueSlice.includes("p.status === 'chamado' ? 'Não respondeu à chamada"), true);
});
