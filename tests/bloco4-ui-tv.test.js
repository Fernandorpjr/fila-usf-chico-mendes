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

test('Bloco 4 Voz da TV: suporta modos Paciente/Usuário/Por Setor/Atenção e aviso Pedir Silêncio', () => {
  const voiceSlice = extractSlice(
    appSrc,
    'function formatarTextoVozClinica(',
    'const AVISO_SILENCIO_TOKEN'
  );
  const spoken = [];
  const ctx = {
    isMuted: false,
    tratamentoVozPreferido: 'por_setor',
    Date,
    getDayAndHourRecife: () => ({ day: 3, hour: 9 }),
    speechQueue: spoken,
    processSpeechQueue: () => {}
  };
  vm.runInNewContext(voiceSlice, ctx);

  // 1) Padrão 'por_setor': Paciente p/ clínicos, Usuário p/ Farmácia/Regulação/Acolhimento/Agendamento
  ctx.speakViaSynthesis('Maria da Silva', 'Médico', 'Consultório 2 - Dra. Mirela Mota');
  ctx.speakViaSynthesis('João Santos', 'Téc. Enfermagem', '');
  ctx.speakViaSynthesis('Ana Paula', 'Farmácia', 'Farmácia');

  assert.equal(
    spoken[0].texto,
    'Bom dia, Paciente Maria da Silva, dirija-se ao Consultório 2, com Doutora Mirela Mota.'
  );
  assert.equal(
    spoken[1].texto,
    'Bom dia, Paciente João Santos, dirija-se à Técnico de Enfermagem.'
  );
  assert.equal(
    spoken[2].texto,
    'Bom dia, Usuário Ana Paula, dirija-se ao Farmácia.'
  );

  // 2) Modo 'usuario' em todos os setores
  ctx.tratamentoVozPreferido = 'usuario';
  ctx.speakViaSynthesis('Maria da Silva', 'Médico', 'Consultório 2 - Dra. Mirela Mota');
  assert.equal(
    spoken[3].texto,
    'Bom dia, Usuário Maria da Silva, dirija-se ao Consultório 2, com Doutora Mirela Mota.'
  );

  // 3) Modo 'paciente' em todos os setores
  ctx.tratamentoVozPreferido = 'paciente';
  ctx.speakViaSynthesis('Ana Paula', 'Farmácia', 'Farmácia');
  assert.equal(
    spoken[4].texto,
    'Bom dia, Paciente Ana Paula, dirija-se ao Farmácia.'
  );

  // 4) Modo 'atencao' direto
  ctx.tratamentoVozPreferido = 'atencao';
  ctx.speakViaSynthesis('Maria da Silva', 'Médico', 'Consultório 2 - Dra. Mirela Mota');
  assert.equal(
    spoken[5].texto,
    'Bom dia. Atenção, Maria da Silva, dirija-se ao Consultório 2, com Doutora Mirela Mota.'
  );

  // 5) Modo 'atencao_setor'
  ctx.tratamentoVozPreferido = 'atencao_setor';
  ctx.speakViaSynthesis('Maria da Silva', 'Médico', 'Consultório 2 - Dra. Mirela Mota');
  ctx.speakViaSynthesis('Ana Paula', 'Farmácia', 'Farmácia');
  assert.equal(
    spoken[6].texto,
    'Bom dia. Atenção, paciente Maria da Silva, dirija-se ao Consultório 2, com Doutora Mirela Mota.'
  );
  assert.equal(
    spoken[7].texto,
    'Bom dia. Atenção, usuário Ana Paula, dirija-se ao Farmácia.'
  );

  // Controles de seletor + botão e banner de Pedir Silêncio na UI e JS
  assert.equal(indexHtml.includes('id="select-tratamento-voz"'), true);
  assert.equal(indexHtml.includes('id="select-tratamento-voz-painel"'), true);
  assert.equal(indexHtml.includes('id="tv-silencio-banner"'), true);
  assert.equal(indexHtml.includes('solicitarSilencioSalaEspera(this)'), true);
  assert.equal(appSrc.includes('executarAvisoSilencioLocal'), true);
  assert.equal(appSrc.includes('__AVISO_SILENCIO__'), true);
});
