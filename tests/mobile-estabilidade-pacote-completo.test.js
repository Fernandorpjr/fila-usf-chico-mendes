const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const segSrc = fs.readFileSync(path.join(ROOT, 'lib', 'seguranca.js'), 'utf8');
const histSrc = fs.readFileSync(path.join(ROOT, 'lib', 'historico.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const prevSrc = fs.readFileSync(path.join(ROOT, 'public', 'receitas-previa.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

const {
  SESSION_TTL_MS,
  isPublicApiRoute,
  shouldRefreshSession,
  warnIfWeakSessionSecret
} = require('../lib/seguranca');

test('Segurança e sessão deslizante: /config/metas-dia público e shouldRefreshSession preciso', () => {
  assert.equal(isPublicApiRoute('GET', '/config/metas-dia'), true);
  assert.equal(isPublicApiRoute('POST', '/config/metas-dia'), false);

  const now = Date.now();
  // Sessão faltando 2h (< 5h) -> deve renovar
  assert.equal(shouldRefreshSession({ exp: now + 2 * 60 * 60 * 1000 }), true);
  // Sessão faltando 8h (> 5h) -> não precisa renovar ainda
  assert.equal(shouldRefreshSession({ exp: now + 8 * 60 * 60 * 1000 }), false);
  // Sessão já expirada -> não renova
  assert.equal(shouldRefreshSession({ exp: now - 1000 }), false);
  assert.equal(shouldRefreshSession(null), false);
  assert.equal(typeof warnIfWeakSessionSecret, 'function');
  assert.ok(SESSION_TTL_MS >= 10 * 60 * 60 * 1000);
});

test('Backend Pacote Completo: sliding session, ETag inteiro, chat sob demanda, índices e auth admin padronizado', () => {
  assert.equal(serverSrc.includes('shouldRefreshSession(sess)'), true);
  assert.equal(serverSrc.includes('warnIfWeakSessionSecret();'), true);

  // /api/queues e /api/acolhimento/fluxo usam minuto inteiro para ETag funcionar com 304
  assert.equal(serverSrc.includes('FLOOR(EXTRACT(EPOCH FROM (NOW() - created_at)) / 60.0)::int AS espera_minutos'), true);
  assert.equal(serverSrc.includes('ROUND(EXTRACT(EPOCH FROM (NOW() - created_at)) / 60.0, 1) AS espera_minutos'), false);

  // Consultas de histórico usam intervalo sargable em America/Recife (ativando idx_call_history_created_at)
  assert.equal(serverSrc.includes('const SQL_HOJE_RECIFE_RANGE ='), true);
  const idxHist = serverSrc.indexOf("app.get('/api/history'");
  const idxHistFilt = serverSrc.indexOf("app.get('/api/history/filtered'");
  const histPublicSlice = serverSrc.slice(idxHist, idxHistFilt);
  assert.equal(histPublicSlice.includes('SQL_HOJE_RECIFE_RANGE'), true);
  assert.equal(histPublicSlice.includes("DATE(created_at AT TIME ZONE 'America/Sao_Paulo')"), false);
  const idxMonthly = serverSrc.indexOf("app.get('/api/history/monthly'");
  const idxAtt = serverSrc.indexOf("app.get('/api/attended'");
  const monthlySlice = serverSrc.slice(idxMonthly, idxAtt);
  assert.equal(monthlySlice.includes("EXTRACT(MONTH FROM created_at AT TIME ZONE 'America/Sao_Paulo')"), false);
  assert.equal(monthlySlice.includes("created_at >= ($1::timestamp AT TIME ZONE 'America/Recife')"), true);

  // Chat leve omite anexo_base64 na listagem e expõe GET /api/chat/anexo/:id
  const idxChatGet = serverSrc.indexOf("app.get('/api/chat/canais/:canal'");
  const idxChatAnexo = serverSrc.indexOf("app.get('/api/chat/anexo/:id'");
  assert.ok(idxChatGet > 0 && idxChatAnexo > idxChatGet);
  const chatGetSlice = serverSrc.slice(idxChatGet, idxChatAnexo);
  assert.equal(chatGetSlice.includes('AS tem_anexo'), true);
  assert.equal(chatGetSlice.includes('SELECT * FROM chat_channels WHERE canal = $1'), false);
  assert.equal(chatGetSlice.includes('responderJsonComEtag(req, res, result.rows)'), true);

  // Rotas admin aceitam isAdminAuthorized (cookie admin) e GET /api/agendamentos tem LIMIT
  assert.equal(serverSrc.includes("LIMIT 500"), true);
  const idxClear = serverSrc.indexOf("app.post('/api/chat/canais/:canal/clear'");
  assert.equal(serverSrc.slice(idxClear, idxClear + 350).includes('isAdminAuthorized(req)'), true);
  const idxDelPost = serverSrc.indexOf("app.post('/api/agendamentos/:id/delete'");
  assert.equal(serverSrc.slice(idxDelPost, idxDelPost + 450).includes('isAdminAuthorized(req)'), true);
  assert.equal(histSrc.includes('req.session && req.session.role === \'admin\''), true);

  // Novos índices de performance
  assert.equal(serverSrc.includes('idx_agendamentos_data_horario'), true);
  assert.equal(serverSrc.includes('idx_notificacoes_setor_dismissed'), true);
  assert.equal(serverSrc.includes('idx_pending_voice_calls_proc_created'), true);
  assert.equal(serverSrc.includes('idx_ctrl_agendamentos_mes_ano'), true);
  assert.equal(segSrc.includes("p === '/config/metas-dia'"), true);
});

test('Frontend Estabilidade & Mobile: anti-falso-401, retry de sessão, debounce, chat sob demanda e DOM diffing', () => {
  assert.equal(appSrc.includes('function confirmarETratarSessaoExpirada()'), true);
  assert.equal(appSrc.includes('async function fetchSessionComRetry('), true);
  assert.equal(appSrc.includes('function agendarRevalidacaoSessaoSilenciosa()'), true);
  assert.equal(appSrc.includes("gateEl.classList.add('gate-checking')"), true);
  assert.equal(appSrc.includes('window._previaCapturaEmAndamento'), true);
  assert.equal(appSrc.includes('document.addEventListener(\'visibilitychange\', onVisibilityChangeDebounced)'), true);
  assert.equal(appSrc.includes('function setHtmlIfChanged('), true);
  assert.equal(appSrc.includes('async function carregarAnexoChatSobDemanda('), true);
  assert.equal(appSrc.includes("loadHistory({ skipDerived: true })"), true);

  // Bug das sub-abas de agendados corrigido para os IDs reais do HTML
  assert.equal(appSrc.includes("document.getElementById('subtab-btn-principal')"), true);
  assert.equal(appSrc.includes("document.getElementById('subtab-btn-historico')"), true);

  // Nenhum resto acidental de segHtml fora de renderSegundaEscutaScreen
  const segMatches = appSrc.match(/setHtmlIfChanged\(container, segHtml\)/g) || [];
  assert.equal(segMatches.length, 1);
});

test('Câmera Mobile & CSS Anti-Flickering: draft, createImageBitmap, inline opcional, overflow-x: clip e sem 100dvh', () => {
  assert.equal(prevSrc.includes('RECEPCAO_DRAFT_STORAGE_KEY'), true);
  assert.equal(prevSrc.includes('function salvarRascunhoRecepcaoPrevia('), true);
  assert.equal(prevSrc.includes('function restaurarRascunhoRecepcaoPrevia('), true);
  assert.equal(prevSrc.includes('createImageBitmap(file, { resizeWidth: MAX'), true);
  assert.equal(prevSrc.includes('function acionarCameraNativaPrevia()'), true);
  assert.equal(prevSrc.includes('async function abrirCameraInlinePrevia()'), true);
  assert.equal(prevSrc.includes('function fecharCameraInlinePrevia()'), true);

  // CSS Mobile anti-flickering sem alterar PC
  assert.equal(indexHtml.includes('html, body { overflow-x: hidden; }'), false);
  assert.equal(indexHtml.includes('body { overflow-x: clip; }'), true);
  assert.equal(indexHtml.includes('height: 100dvh !important;'), false);
  assert.equal(indexHtml.includes('max-height: 100dvh !important;'), false);
  assert.equal(indexHtml.includes('max-height: 92dvh;'), false);
  assert.equal(indexHtml.includes('backdrop-filter: none !important;'), true);
  assert.equal(indexHtml.includes('.gate-overlay.gate-checking'), true);
  assert.equal(indexHtml.includes('id="pr-btn-camera-inline"'), true);
  assert.equal(indexHtml.includes('id="pr-inline-camera-box"'), true);
  assert.equal(indexHtml.includes('onclick="acionarCameraNativaPrevia()"'), true);
});
