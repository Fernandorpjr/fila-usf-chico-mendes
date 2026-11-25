const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const vercelJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

function extractFnSlice(src, startMarker, endMarker) {
  const i1 = src.indexOf(startMarker);
  const i2 = src.indexOf(endMarker, i1);
  assert.ok(i1 >= 0, `Start marker missing: ${startMarker}`);
  assert.ok(i2 > i1, `End marker missing: ${endMarker}`);
  return src.slice(i1, i2);
}

test('Prorrogação de +2h hoje (25/11/2026 até 20h Recife) funciona e expira automaticamente depois das 20h', () => {
  // 1. Extrair e validar lógica do backend (aplicarPisoExpedienteExtra)
  const serverFloorSlice = extractFnSlice(
    serverSrc,
    'const EXPEDIENTE_EXTRA_PADRAO_ATE_ISO =',
    'const _pisoInicialExp ='
  );
  const serverCtx = {};
  vm.runInNewContext(serverFloorSlice, serverCtx);

  const dentro1830 = Date.parse('2026-11-25T18:30:00-03:00');
  const dentro1959 = Date.parse('2026-11-25T19:59:59-03:00');
  const depois2001 = Date.parse('2026-11-25T20:00:01-03:00');
  const amanha1830 = Date.parse('2026-11-26T18:30:00-03:00');

  const cfg1830 = serverCtx.aplicarPisoExpedienteExtra('', dentro1830);
  assert.equal(cfg1830.extraAteIso, '2026-11-25T23:00:00.000Z');
  assert.equal(dentro1830 < cfg1830.extraAteMs, true);

  const cfg1959 = serverCtx.aplicarPisoExpedienteExtra('', dentro1959);
  assert.equal(dentro1959 < cfg1959.extraAteMs, true);

  const cfg2001 = serverCtx.aplicarPisoExpedienteExtra('', depois2001);
  assert.equal(cfg2001.extraAteMs, 0);

  const cfgAmanha = serverCtx.aplicarPisoExpedienteExtra('', amanha1830);
  assert.equal(cfgAmanha.extraAteMs, 0);

  // 2. Extrair e validar isDentroDoHorario + EXPEDIENTE_EXTRA_HOJE_ATE_MS do frontend
  const appTimeSlice = extractFnSlice(
    appSrc,
    'const EXPEDIENTE_EXTRA_HOJE_ATE_MS =',
    'function atualizarBotaoMutirao()'
  );

  function evalFrontDentroHorario(nowIso) {
    const fakeNow = Date.parse(nowIso);
    function FakeDate(...args) {
      if (args.length === 0) return new Date(fakeNow);
      return new Date(...args);
    }
    FakeDate.now = () => fakeNow;
    FakeDate.parse = Date.parse;
    FakeDate.UTC = Date.UTC;
    const ctx = {
      Date: FakeDate,
      Intl,
      parseInt,
      Number,
      Boolean,
      String
    };
    vm.runInNewContext(appTimeSlice, ctx);
    return ctx.isDentroDoHorario();
  }

  assert.equal(evalFrontDentroHorario('2026-11-25T18:30:00-03:00'), true);
  assert.equal(evalFrontDentroHorario('2026-11-25T19:59:59-03:00'), true);
  assert.equal(evalFrontDentroHorario('2026-11-25T20:00:01-03:00'), false);
  assert.equal(evalFrontDentroHorario('2026-11-26T18:30:00-03:00'), false);
});

test('responderJsonComEtag gera ETag W/"...", evita cache compartilhado e responde 304 no If-None-Match', () => {
  const etagSlice = extractFnSlice(
    serverSrc,
    'function responderJsonComEtag(req, res, payload)',
    '// === BLOQUEIO POR HORÁRIO'
  );
  const ctx = { crypto, Buffer };
  vm.runInNewContext(etagSlice, ctx);

  function createMockRes() {
    const headers = {};
    return {
      headers,
      statusCode: 200,
      contentType: null,
      body: undefined,
      ended: false,
      set(k, v) { headers[k.toLowerCase()] = v; },
      removeHeader(k) { delete headers[k.toLowerCase()]; },
      status(code) { this.statusCode = code; return this; },
      type(t) { this.contentType = t; return this; },
      send(b) { this.body = b; return this; },
      end() { this.ended = true; return this; }
    };
  }

  const payload = { ok: true, itens: [1, 2, 3] };
  const res1 = createMockRes();
  ctx.responderJsonComEtag({ headers: {} }, res1, payload);

  assert.equal(res1.statusCode, 200);
  assert.match(res1.headers.etag, /^W\/"[0-9a-f]+-[0-9a-f]{16}"$/);
  assert.equal(res1.headers['cache-control'], 'private, no-cache, must-revalidate');
  assert.equal(res1.headers['surrogate-control'], 'no-store');
  assert.equal(res1.body, JSON.stringify(payload));

  const res2 = createMockRes();
  ctx.responderJsonComEtag({ headers: { 'if-none-match': res1.headers.etag } }, res2, payload);
  assert.equal(res2.statusCode, 304);
  assert.equal(res2.ended, true);
  assert.equal(res2.body, undefined);

  const res3 = createMockRes();
  ctx.responderJsonComEtag({ headers: { 'if-none-match': res1.headers.etag } }, res3, { ok: true, itens: [1, 2, 4] });
  assert.equal(res3.statusCode, 200);
  assert.notEqual(res3.headers.etag, res1.headers.etag);
});

test('Bloco 2 SQL & Vercel/Neon: elimina loops N+1, protege initDB por versão e otimiza chat/ETag', () => {
  // 1. Pool & Express & Vercel config
  assert.equal(serverSrc.includes('allowExitOnIdle: true'), true);
  assert.equal(serverSrc.includes("limit: '4.4mb'"), true);
  assert.equal(vercelJson.functions['server.js'].maxDuration, 120);
  assert.equal(vercelJson.functions['api/**/*'].maxDuration, 120);

  // 2. initDB version guard + composite indexes
  assert.equal(serverSrc.includes('const DB_SCHEMA_VERSION ='), true);
  assert.equal(serverSrc.includes("chave = 'db_schema_version'"), true);
  assert.equal(serverSrc.includes('idx_patients_setor_status'), true);
  assert.equal(serverSrc.includes('idx_patients_status_created'), true);
  assert.equal(serverSrc.includes('idx_call_history_created_at'), true);
  assert.equal(serverSrc.includes('idx_chat_channels_canal_id'), true);

  // 3. /api/current-calling sem loop for(SETORES), usando CTE única e projeção LGPD segura
  const idxCurr = serverSrc.indexOf("app.get('/api/current-calling'");
  const idxDashMetrics = serverSrc.indexOf("app.get('/api/dashboard/metrics'", idxCurr);
  const currSlice = serverSrc.slice(idxCurr, idxDashMetrics);
  assert.equal(currSlice.includes('for (const setor of SETORES)'), false);
  assert.equal(currSlice.includes('DISTINCT ON (setor)'), true);
  assert.equal(currSlice.includes('responderJsonComEtag(req, res,'), true);
  assert.equal(currSlice.includes('exames_coleta'), false);
  assert.equal(currSlice.includes('cartao_sus'), false);

  // 4. /api/chat/unread/:setor e /api/chat/resumo/:setor em consulta única (sem loop N+1)
  const idxUnread = serverSrc.indexOf("app.get('/api/chat/unread/:setor'");
  const idxPresenca = serverSrc.indexOf("app.post('/api/chat/presenca'");
  const chatSummarySlice = serverSrc.slice(idxUnread, idxPresenca);
  assert.equal(chatSummarySlice.includes('for (const canal of CANAIS_CHAT)'), false);
  assert.equal(chatSummarySlice.includes('unnest($1::text[])'), true);
  assert.equal(chatSummarySlice.includes("app.get('/api/chat/resumo/:setor'"), true);
  assert.equal(chatSummarySlice.includes(', anexo_base64'), false);
  assert.equal(chatSummarySlice.includes('SELECT *'), false);

  // 5. ETag aplicado nas rotas quentes de polling
  for (const route of [
    "app.get('/api/queues'",
    "app.get('/api/history'",
    "app.get('/api/tv/history'",
    "app.get('/api/acolhimento/fluxo'"
  ]) {
    const idx = serverSrc.indexOf(route);
    assert.ok(idx >= 0, `Route not found: ${route}`);
    const slice = serverSrc.slice(idx, idx + 1500);
    assert.equal(slice.includes('responderJsonComEtag(req, res,'), true, `${route} should use responderJsonComEtag`);
  }

  // 6. Reordenações em lote via unnest (sem loop de UPDATE individual)
  const idxReord = serverSrc.indexOf('async function reordenarFilaSetor');
  const idxFixar = serverSrc.indexOf('async function fixarPrioritarioNoTopoDaFila');
  const reordSlice = serverSrc.slice(idxReord, idxFixar);
  assert.equal(reordSlice.includes('FROM unnest($1::int[], $2::int[], $3::smallint[])'), true);

  // 7. Frontend loadAllChannels consome /chat/resumo/:setor em 1 única chamada por ciclo
  const idxLoadAll = appSrc.indexOf('async function loadAllChannels()');
  const idxFmt = appSrc.indexOf('function formatarRotuloDataChatRecife');
  const loadAllSlice = appSrc.slice(idxLoadAll, idxFmt);
  assert.equal(loadAllSlice.includes('/chat/resumo/'), true);
  assert.equal(loadAllSlice.includes('getVisibleCanais().map(c => loadChannelMessages'), false);
});

test('Enfermeira Renata Célia está cadastrada no setor Enfermagem, agendamentos, formulários e SISREG', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const regJs = fs.readFileSync(path.join(ROOT, 'public', 'regulacao-sisreg.js'), 'utf8');
  const { inferirSetorDestinoDevolucao } = require('../lib/sisreg');

  assert.equal(serverSrc.includes("'Renata Célia', 'Enfermeira – Estratégia Saúde da Família'"), true);
  assert.equal(serverSrc.includes("profNorm.includes('renata')"), true);
  assert.match(appSrc, /'Enfermagem':[\s\S]{0,180}profissionais:\s*\[[^\]]*'Renata Célia'/);
  assert.equal(appSrc.includes("'renata célia': 'Enfermeira – Estratégia Saúde da Família'"), true);
  assert.equal(regJs.includes("'Renata Célia'"), true);
  assert.equal(inferirSetorDestinoDevolucao('Exame pendente', 'Renata Célia'), 'Enfermagem');

  const ocorrenciasHtml = indexHtml.match(/Renata Célia/g) || [];
  assert.equal(ocorrenciasHtml.length >= 4, true, 'Renata Célia deve aparecer nos 4 selects de filtros/agendamento');
});
