const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

function extractSlice(src, startMarker, endMarker) {
  const i1 = src.indexOf(startMarker);
  const i2 = src.indexOf(endMarker, i1);
  assert.ok(i1 >= 0, `Start marker missing: ${startMarker}`);
  assert.ok(i2 > i1, `End marker missing: ${endMarker}`);
  return src.slice(i1, i2);
}

test('Agendamentos UI/CSS: elimina sobrescrita que deixava botões brancos e garante contraste no modal WhatsApp', () => {
  // Não deve existir regra genérica `.agend-actions button{` sem `:not(.agend-action-btn)`
  assert.equal(/\.agend-actions\s+button\s*\{/.test(indexHtml), false);
  assert.equal(indexHtml.includes('.agend-actions button:not(.agend-action-btn)'), true);
  assert.equal(indexHtml.includes('.agend-action-btn--wa { background: linear-gradient(135deg, #16a34a, #15803d) !important;'), true);
  assert.equal(indexHtml.includes('.wa-modal .btn-ghost { background: #f1f5f9; color: #334155;'), true);
  assert.equal(indexHtml.includes('id="wa-dest-info"'), true);
  assert.equal(indexHtml.includes('id="wa-aviso-telefone"'), true);
  assert.equal(indexHtml.includes('id="wa-fallback-link"'), true);
  assert.equal(indexHtml.includes('id="lembretes-d1-quando"'), true);
});

test('WhatsApp helpers: normalização de telefone brasileiro (DDD + DDI 55), URL mobile vs desktop e D-1 pulando fim de semana', () => {
  const waHelpersSlice = extractSlice(
    appSrc,
    '// ====== WHATSAPP: helpers de telefone',
    'async function buscarAgendamentoPorId('
  );

  // Testar modo Desktop
  const desktopCtx = {
    navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0' }
  };
  vm.runInNewContext(waHelpersSlice, desktopCtx);

  assert.equal(desktopCtx.normalizarTelefoneWhatsApp('(81) 99988-7766'), '5581999887766');
  assert.equal(desktopCtx.normalizarTelefoneWhatsApp('+55 81 99988-7766'), '5581999887766');
  assert.equal(desktopCtx.normalizarTelefoneWhatsApp('081 999887766'), '5581999887766');
  assert.equal(desktopCtx.normalizarTelefoneWhatsApp('81 3333-4444'), '558133334444');
  assert.equal(desktopCtx.normalizarTelefoneWhatsApp('12345'), '');
  assert.equal(desktopCtx.formatarTelefoneExibicao('81999887766'), '+55 (81) 99988-7766');
  assert.equal(
    desktopCtx.montarUrlWhatsApp('5581999887766', 'Olá Paciente'),
    'https://web.whatsapp.com/send?phone=5581999887766&text=Ol%C3%A1%20Paciente'
  );

  // Testar modo Mobile (wa.me)
  const mobileCtx = {
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) Mobile Safari/537.36' }
  };
  vm.runInNewContext(waHelpersSlice, mobileCtx);
  assert.equal(
    mobileCtx.montarUrlWhatsApp('5581999887766', 'Oi'),
    'https://wa.me/5581999887766?text=Oi'
  );

  // Testar getProximoDiaUtilRecife (sexta 27/11/2026 -> segunda 30/11/2026; quinta 26/11/2026 -> sexta 27/11/2026)
  const d1Slice = extractSlice(
    appSrc,
    'function getProximoDiaUtilRecife()',
    'async function loadLembretesD1()'
  );
  const d1SexCtx = { getDataHojeRecife: () => '2026-11-27', Date };
  vm.runInNewContext(d1Slice, d1SexCtx);
  assert.equal(d1SexCtx.getProximoDiaUtilRecife(), '2026-11-30');
  assert.equal(d1SexCtx.descreverQuandoDia('2026-11-30'), 'segunda-feira');
  assert.equal(d1SexCtx.descreverQuandoDia('2026-11-27'), 'hoje');

  const d1QuiCtx = { getDataHojeRecife: () => '2026-11-26', Date };
  vm.runInNewContext(d1Slice, d1QuiCtx);
  assert.equal(d1QuiCtx.getProximoDiaUtilRecife(), '2026-11-27');
  assert.equal(d1QuiCtx.descreverQuandoDia('2026-11-27'), 'amanhã');
});

test('WhatsApp abertura síncrona sem bloqueio de pop-up e rota GET /api/agendamentos/:id', () => {
  // abrirWhatsAppEEnviar chama concluirAberturaWhatsApp ANTES de await registrarMensagemEnviada
  const sendSlice = extractSlice(appSrc, 'async function abrirWhatsAppEEnviar()', 'async function registrarMensagemEnviada(');
  const idxOpenSync = sendSlice.indexOf('concluirAberturaWhatsApp(');
  const idxAwaitReg = sendSlice.indexOf('await registrarMensagemEnviada(');
  assert.ok(idxOpenSync > 0 && idxAwaitReg > idxOpenSync, 'abrirWhatsAppEEnviar deve abrir a aba antes do await');

  // salvarEditarEnvio (individual) e dispararItemFila chamam abrirJanelaWhatsAppPendente() antes do primeiro await
  const salvarSlice = extractSlice(appSrc, 'async function salvarEditarEnvio()', '// ====== FILA DE DISPARO EM LOTE');
  const idxInd = salvarSlice.indexOf('// Individual');
  const indSlice = salvarSlice.slice(idxInd);
  assert.ok(indSlice.indexOf('abrirJanelaWhatsAppPendente()') < indSlice.indexOf('await fetch('));
  assert.equal(indSlice.includes('concluirAberturaWhatsApp('), true);

  const loteSlice = extractSlice(appSrc, 'async function dispararItemFila(index)', 'function fecharFilaDisparoLote()');
  assert.ok(loteSlice.indexOf('abrirJanelaWhatsAppPendente()') < loteSlice.indexOf('await copiarImagemParaClipboard('));
  assert.equal(loteSlice.includes('concluirAberturaWhatsApp('), true);

  // Busca por ID via API + rota segura no server.js que não sombreia subrotas nomeadas
  assert.equal(appSrc.includes('async function buscarAgendamentoPorId('), true);
  assert.equal(serverSrc.includes("app.get('/api/agendamentos/:id'"), true);
  assert.equal(serverSrc.includes("!/^\\d+$/.test(rawId)"), true);
  assert.equal(serverSrc.includes('LIMIT 2000'), true);
});

test('Agendamentos UX Pro: remove Coleta de Sangue e Enviar p/ Fila, reorganiza botões coloridos e painéis recolhíveis', () => {
  // Dashboard de Coleta de Sangue removido da aba Agendamentos
  assert.equal(indexHtml.includes('id="coleta-dashboard-container"'), false);
  assert.equal(indexHtml.includes('Dashboard de Coleta de Sangue'), false);

  // Botão Enviar p/ Fila removido da tabela de agendamentos
  const renderAgendSlice = extractSlice(appSrc, 'function renderAgendamentos(list)', 'async function updateAgendStatus(');
  assert.equal(renderAgendSlice.includes('Enviar p/ Fila'), false);
  assert.equal(renderAgendSlice.includes('agend-action-btn--fila'), false);

  // loadAgendamentos não chama mais loadColetasStats
  const loadAgendSlice = extractSlice(appSrc, 'async function loadAgendamentos()', 'function filtrarAgendamentosLocal()');
  assert.equal(loadAgendSlice.includes('loadColetasStats'), false);

  // Organização semântica dos botões + cores vivas + KPI strip + busca rápida + seções recolhíveis
  assert.equal(indexHtml.includes('.agend-actions-primary'), true);
  assert.equal(indexHtml.includes('.agend-actions-utils'), true);
  assert.equal(indexHtml.includes('.agend-action-btn--edit'), true);
  assert.equal(indexHtml.includes('.agend-action-btn--img'), true);
  assert.equal(indexHtml.includes('id="agend-kpi-strip"'), true);
  assert.equal(indexHtml.includes('id="agend-filter-busca"'), true);
  assert.equal(indexHtml.includes('.agend-d1-collapse'), true);
  assert.equal(indexHtml.includes('.agend-secondary-collapse'), true);

  assert.equal(renderAgendSlice.includes('agend-actions-primary'), true);
  assert.equal(renderAgendSlice.includes('agend-actions-utils'), true);
  assert.equal(renderAgendSlice.includes('agend-action-btn--edit'), true);
  assert.equal(renderAgendSlice.includes('openWaPreview('), true);

  const renderD1Slice = extractSlice(appSrc, 'function renderLembretesD1(', 'async function excluirLembreteD1(');
  assert.equal(renderD1Slice.includes('agend-actions-primary'), true);
  assert.equal(renderD1Slice.includes('agend-actions-utils'), true);
  assert.equal(renderD1Slice.includes('agend-action-btn--img'), true);
  assert.equal(renderD1Slice.includes('openWaPreview('), true);
});
