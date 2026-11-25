const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');

function extractSlice(src, startMarker, endMarker) {
  const i1 = src.indexOf(startMarker);
  const i2 = src.indexOf(endMarker, i1);
  assert.ok(i1 >= 0, `Start marker missing: ${startMarker}`);
  assert.ok(i2 > i1, `End marker missing: ${endMarker}`);
  return src.slice(i1, i2);
}

test('Segunda Tela Administrativa centraliza Contingência A4 e Equipe/Mutirão sem poluir Recepção', () => {
  // Botão solto removido da Recepção e movido para barra administrativa
  assert.equal(indexHtml.includes('id="btn-contingencia-recepcao"'), false);
  assert.equal(indexHtml.includes("abrirModalContingenciaOffline('contingencia')"), true);

  // Estrutura de Segunda Tela (previa-modal-backdrop fo-modal-backdrop) com abas + prévia A4
  const idxSec = indexHtml.indexOf('id="modal-contingencia-offline"');
  assert.ok(idxSec > 0);
  const secSlice = indexHtml.slice(idxSec, idxSec + 5500);
  assert.equal(secSlice.includes('previa-modal-backdrop fo-modal-backdrop'), true);
  assert.equal(secSlice.includes('id="seg-tab-btn-contingencia"'), true);
  assert.equal(secSlice.includes('id="seg-tab-btn-equipe"'), true);
  assert.equal(secSlice.includes('id="contingencia-filtro-setor"'), true);
  assert.equal(secSlice.includes('id="contingencia-paper-preview"'), true);
  assert.equal(secSlice.includes('id="modal-equipe-mutirao"'), true);

  // Impressão sem bloqueio via iframe + filtro de setor na folha
  assert.equal(appSrc.includes('usf-print-contingencia-frame'), true);
  assert.equal(appSrc.includes('renderPreviewFolhaContingencia'), true);
  assert.equal(appSrc.includes('alternarAbaSegundaTelaAdmin'), true);
});

test('Bloco 4 UI/UX: define .modal-overlay, .btn-outline, foco acessível, #toast z-index 100100 e Alto Contraste TV', () => {
  assert.equal(indexHtml.includes('.modal-overlay { display: none;'), true);
  assert.equal(indexHtml.includes('.btn-outline {'), true);
  assert.equal(indexHtml.includes('button:focus-visible'), true);
  assert.equal(indexHtml.includes('z-index: 100100;'), true);
  assert.equal(indexHtml.includes('.painel-screen.painel-alto-contraste'), true);
  assert.equal(indexHtml.includes('id="btn-painel-contraste"'), true);
  assert.equal(indexHtml.includes('clamp(42px, 4.3vw, 64px)'), true);
  assert.equal(indexHtml.includes('.row-prio-nivel1'), true);
  assert.equal(indexHtml.includes('.row-prio-nivel2'), true);

  // Modo público da TV oculta botão de rechamada por linha
  const idxUpdatePainel = appSrc.indexOf('function updatePainel()');
  const idxEndPainel = appSrc.indexOf('// ====== SECTOR ATTENDED HISTORY', idxUpdatePainel);
  const painelSlice = appSrc.slice(idxUpdatePainel, idxEndPainel);
  assert.equal(painelSlice.includes('!isGateAuthenticated && isModoTV()'), true);
});

test('Bloco 4 Voz da TV: expande Dr./Dra./Téc. Enfermagem e formata chamada respeitosa no fuso Recife', () => {
  const voiceSlice = extractSlice(
    appSrc,
    'function formatarTextoVozClinica(',
    'function getRealCallsFromHistory()'
  );
  const spoken = [];
  const ctx = {
    isMuted: false,
    Date,
    getDayAndHourRecife: () => ({ day: 3, hour: 9 }),
    speechQueue: spoken,
    processSpeechQueue: () => {}
  };
  vm.runInNewContext(voiceSlice, ctx);

  ctx.speakViaSynthesis('Maria da Silva', 'Médico', 'Consultório 2 - Dra. Mirela Mota');
  assert.equal(spoken.length, 1);
  assert.equal(
    spoken[0].texto,
    'Bom dia. Atenção, Maria da Silva. Por favor, dirija-se ao Consultório 2, com Doutora Mirela Mota.'
  );

  ctx.speakViaSynthesis('João Santos', 'Téc. Enfermagem', '');
  assert.equal(
    spoken[1].texto,
    'Bom dia. Atenção, João Santos. Por favor, dirija-se à Técnico de Enfermagem.'
  );
});
