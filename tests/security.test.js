const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  SESSION_COOKIE_NAME,
  DEFAULT_GATE_HASH,
  LEGACY_ADMIN_HASHES,
  DEFAULT_MANAGER_HASH,
  sha256Hex,
  safeEqualStr,
  parseCookies,
  appendSetCookie,
  createSessionToken,
  verifySessionToken,
  isValidGatePass,
  isValidAdminPass,
  isValidManagerPass,
  resolvePrivilegedRole,
  isPublicApiRoute,
  getClientIp,
  isRateLimited,
  recordRateLimitHit,
  resetRateLimit,
  checkRateLimit,
  buildCorsOptions
} = require('../lib/seguranca');
const {
  MAX_TENTATIVAS_ANTES_BLOQUEIO,
  MAX_TENTATIVAS_EMERGENCIA,
  DURACAO_BLOQUEIO_TEMP_MS,
  calcularEstadoBloqueioAtual,
  calcularProximoEstadoFalha,
  calcularProximoEstadoFalhaEmergencia
} = require('../lib/dispositivos');
const { limparPreviasExpiradas } = require('../lib/receitas');

test('HMAC session tokens validate, reject tampering, and enforce expiration', () => {
  const prevSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'unit-test-hmac-secret-2026';
  try {
    const token = createSessionToken('staff', 60_000);
    const parsed = verifySessionToken(token);
    assert.ok(parsed);
    assert.equal(parsed.v, 1);
    assert.equal(parsed.role, 'staff');
    assert.ok(parsed.exp > Date.now());

    const adminToken = createSessionToken('admin', 60_000);
    assert.equal(verifySessionToken(adminToken)?.role, 'admin');

    const gerenteToken = createSessionToken('gerente', 60_000);
    assert.equal(verifySessionToken(gerenteToken)?.role, 'gerente');

    const [payloadB64, sigB64] = token.split('.');
    const tamperedSig = `${payloadB64}.${sigB64.slice(0, -1)}${sigB64.endsWith('a') ? 'b' : 'a'}`;
    assert.equal(verifySessionToken(tamperedSig), null);

    const forgedPayload = Buffer.from(JSON.stringify({ v: 1, role: 'admin', exp: Date.now() + 60_000 })).toString('base64url');
    assert.equal(verifySessionToken(`${forgedPayload}.${sigB64}`), null);

    const expiredPayload = Buffer.from(JSON.stringify({ v: 1, role: 'staff', iat: Date.now() - 120_000, exp: Date.now() - 1000 })).toString('base64url');
    const expiredSig = require('node:crypto').createHmac('sha256', process.env.SESSION_SECRET).update(expiredPayload).digest('base64url');
    assert.equal(verifySessionToken(`${expiredPayload}.${expiredSig}`), null);
    assert.equal(verifySessionToken('malformed-token'), null);
    assert.equal(verifySessionToken(''), null);
  } finally {
    if (prevSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = prevSecret;
  }
});

test('isValidGatePass supports GATE_PASSWORD, GATE_HASH, and non-empty checks', () => {
  const prevPass = process.env.GATE_PASSWORD;
  const prevHash = process.env.GATE_HASH;
  try {
    delete process.env.GATE_HASH;
    process.env.GATE_PASSWORD = 'senha-recepcao-teste,outra-senha';
    assert.equal(isValidGatePass('senha-recepcao-teste'), true);
    assert.equal(isValidGatePass(' outra-senha '), true);
    assert.equal(isValidGatePass('errada'), false);
    assert.equal(isValidGatePass(''), false);

    delete process.env.GATE_PASSWORD;
    process.env.GATE_HASH = sha256Hex('hash-only-secret');
    assert.equal(isValidGatePass('hash-only-secret'), true);
    assert.equal(isValidGatePass('wrong-pass'), false);

    delete process.env.GATE_HASH;
    assert.equal(typeof DEFAULT_GATE_HASH, 'string');
    assert.equal(DEFAULT_GATE_HASH.length, 64);
    assert.equal(isValidGatePass('definitivamente-errada-12345'), false);
  } finally {
    if (prevPass === undefined) delete process.env.GATE_PASSWORD;
    else process.env.GATE_PASSWORD = prevPass;
    if (prevHash === undefined) delete process.env.GATE_HASH;
    else process.env.GATE_HASH = prevHash;
  }
});

test('isValidAdminPass e isValidManagerPass validam papéis separados com timing-safe comparison', () => {
  const prevAdmins = process.env.ADMIN_PASSWORDS;
  const prevManagers = process.env.MANAGER_PASSWORDS;
  try {
    assert.equal(Array.isArray(LEGACY_ADMIN_HASHES), true);
    assert.equal(LEGACY_ADMIN_HASHES.length, 1);
    assert.equal(LEGACY_ADMIN_HASHES.includes(DEFAULT_GATE_HASH), false);
    LEGACY_ADMIN_HASHES.forEach(h => assert.match(h, /^[a-f0-9]{64}$/));
    assert.match(DEFAULT_MANAGER_HASH, /^[a-f0-9]{64}$/);
    assert.notEqual(DEFAULT_MANAGER_HASH, LEGACY_ADMIN_HASHES[0]);
    assert.notEqual(DEFAULT_MANAGER_HASH, DEFAULT_GATE_HASH);

    process.env.ADMIN_PASSWORDS = 'admin-alpha-test';
    process.env.MANAGER_PASSWORDS = 'gerente-beta-test';
    assert.equal(isValidAdminPass('admin-alpha-test'), true);
    assert.equal(isValidAdminPass('gerente-beta-test'), false);
    assert.equal(isValidManagerPass('gerente-beta-test'), true);
    assert.equal(isValidManagerPass('admin-alpha-test'), false);
    assert.equal(resolvePrivilegedRole('admin-alpha-test'), 'admin');
    assert.equal(resolvePrivilegedRole('gerente-beta-test'), 'gerente');
    assert.equal(resolvePrivilegedRole('senha-invalida-qualquer'), null);
    assert.equal(isValidAdminPass(''), false);
    assert.equal(isValidManagerPass(''), false);
    assert.equal(safeEqualStr('abc', 'abc'), true);
    assert.equal(safeEqualStr('abc', 'abd'), false);
  } finally {
    if (prevAdmins === undefined) delete process.env.ADMIN_PASSWORDS;
    else process.env.ADMIN_PASSWORDS = prevAdmins;
    if (prevManagers === undefined) delete process.env.MANAGER_PASSWORDS;
    else process.env.MANAGER_PASSWORDS = prevManagers;
  }
});

test('isPublicApiRoute restricts public routes to TV, QR status, auth, health, heartbeat, and cron', () => {
  // Públicas permitidas
  assert.equal(isPublicApiRoute('GET', '/health'), true);
  assert.equal(isPublicApiRoute('POST', '/auth/login'), true);
  assert.equal(isPublicApiRoute('POST', '/auth/logout'), true);
  assert.equal(isPublicApiRoute('GET', '/auth/session'), true);
  assert.equal(isPublicApiRoute('POST', '/verify-admin'), true);
  assert.equal(isPublicApiRoute('GET', '/config/pausa'), true);
  assert.equal(isPublicApiRoute('GET', '/config/mutirao-hoje'), true);
  assert.equal(isPublicApiRoute('GET', '/config/jingle'), true);
  assert.equal(isPublicApiRoute('GET', '/current-calling'), true);
  assert.equal(isPublicApiRoute('GET', '/tv/history'), true);
  assert.equal(isPublicApiRoute('GET', '/voice-call/pending'), true);
  assert.equal(isPublicApiRoute('POST', '/voice-call/12/ack'), true);
  assert.equal(isPublicApiRoute('GET', '/tts'), true);
  assert.equal(isPublicApiRoute('POST', '/tts'), true);
  assert.equal(isPublicApiRoute('GET', '/patients/42/status'), true);
  assert.equal(isPublicApiRoute('POST', '/dispositivos/heartbeat'), true);
  assert.equal(isPublicApiRoute('GET', '/cron/limpeza'), true);

  // Protegidas (exigem sessão ou admin)
  assert.equal(isPublicApiRoute('GET', '/queues'), false);
  assert.equal(isPublicApiRoute('GET', '/history'), false);
  assert.equal(isPublicApiRoute('GET', '/attended'), false);
  assert.equal(isPublicApiRoute('GET', '/patients/42/previa-receita'), false);
  assert.equal(isPublicApiRoute('GET', '/patients/autocomplete'), false);
  assert.equal(isPublicApiRoute('POST', '/patients'), false);
  assert.equal(isPublicApiRoute('POST', '/receita-previa/analisar'), false);
  assert.equal(isPublicApiRoute('POST', '/sisreg/analisar-ficha'), false);
  assert.equal(isPublicApiRoute('GET', '/sisreg/devolucoes'), false);
  assert.equal(isPublicApiRoute('POST', '/voice-call'), false);
  assert.equal(isPublicApiRoute('GET', '/dashboard/metrics'), false);
  assert.equal(isPublicApiRoute('GET', '/admin/relatorio-prioridade-busca'), false);
  assert.equal(isPublicApiRoute('GET', '/chat/canais/geral'), false);
  assert.equal(isPublicApiRoute('POST', '/config/pausa'), false);
});

test('Rate limiting tracks failures cleanly, resets on success, and enforces sliding window caps', () => {
  const ipA = '198.51.100.10';
  const ipB = '198.51.100.11';
  resetRateLimit('test_gate', ipA);
  resetRateLimit('test_gate', ipB);

  for (let i = 0; i < 3; i++) {
    assert.equal(isRateLimited('test_gate', ipA, 3, 60_000).blocked, false);
    recordRateLimitHit('test_gate', ipA, 60_000);
  }
  assert.equal(isRateLimited('test_gate', ipA, 3, 60_000).blocked, true);
  assert.equal(isRateLimited('test_gate', ipB, 3, 60_000).blocked, false);

  resetRateLimit('test_gate', ipA);
  assert.equal(isRateLimited('test_gate', ipA, 3, 60_000).blocked, false);

  resetRateLimit('test_ocr', ipA);
  assert.equal(checkRateLimit('test_ocr', ipA, 2, 60_000).allowed, true);
  assert.equal(checkRateLimit('test_ocr', ipA, 2, 60_000).allowed, true);
  assert.equal(checkRateLimit('test_ocr', ipA, 2, 60_000).allowed, false);
});

test('Cookies and CORS allow only clinic origin, localhost, and same-origin requests', () => {
  const headers = new Map();
  const mockRes = {
    getHeader: k => headers.get(k),
    setHeader: (k, v) => headers.set(k, v)
  };
  appendSetCookie(mockRes, 'usf_did=abc; Path=/');
  appendSetCookie(mockRes, `${SESSION_COOKIE_NAME}=tok; Path=/; HttpOnly`);
  assert.equal(Array.isArray(headers.get('Set-Cookie')), true);
  assert.equal(headers.get('Set-Cookie').length, 2);

  const parsed = parseCookies({ headers: { cookie: `a=1; ${SESSION_COOKIE_NAME}=tok%2E1` } });
  assert.equal(parsed[SESSION_COOKIE_NAME], 'tok.1');

  assert.equal(getClientIp({ headers: { 'x-forwarded-for': '::ffff:203.0.113.9, 10.0.0.1' } }), '203.0.113.9');

  const corsOpts = buildCorsOptions();
  const checkOrigin = (origin) => new Promise((resolve) => {
    corsOpts.origin(origin, (_err, allow) => resolve(allow));
  });
  return Promise.all([
    checkOrigin('https://fila-usf-chico-mendes.vercel.app'),
    checkOrigin('http://localhost:3000'),
    checkOrigin(undefined),
    checkOrigin('https://evil-phishing.example.com')
  ]).then(([prodOk, localOk, sameOriginOk, evilOk]) => {
    assert.equal(prodOk, true);
    assert.equal(localOk, true);
    assert.equal(sameOriginOk, true);
    assert.equal(evilOk, false);
  });
});

test('limparPreviasExpiradas deletes receitas_previas older than 24h safely', async () => {
  const queries = [];
  const mockDb = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('to_regclass')) return { rows: [{ tbl: 'receitas_previas' }] };
      if (sql.startsWith('DELETE FROM receitas_previas')) return { rowCount: 4 };
      return { rows: [], rowCount: 0 };
    }
  };
  const removed = await limparPreviasExpiradas(mockDb, 24);
  assert.equal(removed, 4);
  const delCall = queries.find(q => q.sql.startsWith('DELETE FROM receitas_previas'));
  assert.ok(delCall);
  assert.match(delCall.sql, /COALESCE\(updated_at, created_at\) < \(CURRENT_TIMESTAMP - \(\$1 \|\| ' hours'\)::interval\)/);
  assert.deepEqual(delCall.params, [24]);
});

test('Static security audit verifies secrets and insecure patterns are removed', () => {
  const root = path.join(__dirname, '..');
  const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  const serverJs = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const dispJs = fs.readFileSync(path.join(root, 'lib', 'dispositivos.js'), 'utf8');
  const histJs = fs.readFileSync(path.join(root, 'lib', 'historico.js'), 'utf8');
  const sumarioMd = fs.readFileSync(path.join(root, 'SUMARIO.md'), 'utf8');

  assert.equal(appJs.includes('GATE_HASH'), false);
  assert.equal(appJs.includes(DEFAULT_GATE_HASH), false);
  assert.equal(appJs.includes('Y2hpY28xMjM='), false);
  assert.equal(serverJs.includes('chico123'), false);
  assert.equal(serverJs.includes('s-maxage=3'), false);
  assert.equal(serverJs.includes('req.query?.senha'), false);
  assert.equal(dispJs.includes('req.query.senha'), false);
  assert.equal(histJs.includes('req.query.senha'), false);
  assert.equal(sumarioMd.includes('usf2026'), false);
  assert.equal(sumarioMd.includes('0177'), false);
  assert.equal(sumarioMd.includes('7710'), false);
});

test('Forms do not leak internal 1a/2a Escuta comments', () => {
  const root = path.join(__dirname, '..');
  const formsJs = fs.readFileSync(path.join(root, 'public', 'formularios-pec.js'), 'utf8');

  assert.equal(formsJs.includes('motivo_primeira_escuta'), false);
  assert.equal(formsJs.includes('observacao_segunda_escuta'), false);
  assert.equal(formsJs.includes('1ª Escuta:'), false);
  assert.equal(formsJs.includes('2ª Escuta:'), false);
});

test('2a Escuta resolves profissional_destino cleanly and HTML forms prioritize directed profissional over localStorage', () => {
  const vm = require('node:vm');
  const root = path.join(__dirname, '..');
  const formsJs = fs.readFileSync(path.join(root, 'public', 'formularios-pec.js'), 'utf8');

  const sandbox = {
    window: { location: { origin: 'http://localhost:3000' }, addEventListener: () => {} },
    document: { getElementById: () => null },
    SECTOR_CONFIG: {
      'Médico': { key: 'medico', profissionais: ['Dr. Israel Christian', 'Dr. Joene Halan', 'Dra. Mirela Mota'] },
      'Acolhimento': { key: 'acolhimento' }
    },
    sectorFilters: {},
    queues: {},
    acolhimentoFluxo: { recepcao: [], primeira_escuta: [], segunda_escuta: [] },
    attendedPatients: [],
    console
  };
  vm.runInNewContext(formsJs, sandbox);

  // 1. 2ª Escuta com profissional_destino='Dra. Mirela Mota' e profissional=null/medico=null
  assert.equal(
    sandbox.obterProfissionalSelecionadoSetor('Acolhimento', {
      id: 10,
      setor: 'Acolhimento',
      etapa_fluxo: 'segunda_escuta',
      profissional_destino: 'Dra. Mirela Mota',
      profissional: null,
      medico: null
    }),
    'Dra. Mirela Mota'
  );

  // 2. 2ª Escuta com medico='2ª Escuta' e profissional_destino='Dra. Mirela Mota'
  assert.equal(
    sandbox.obterProfissionalSelecionadoSetor('Acolhimento', {
      id: 11,
      setor: 'Acolhimento',
      etapa_fluxo: 'segunda_escuta',
      medico: '2ª Escuta',
      profissional_destino: 'Dra. Mirela Mota'
    }),
    'Dra. Mirela Mota'
  );

  // 3. limparNomeProfissional strips prefixes/parentheses and rejects generic placeholders
  assert.equal(sandbox.limparNomeProfissional('2ª Escuta (Dra. Mirela Mota)'), 'Dra. Mirela Mota');
  assert.equal(sandbox.limparNomeProfissional('2ª Escuta - Dra. Mirela Mota'), 'Dra. Mirela Mota');
  assert.equal(sandbox.limparNomeProfissional('Se dirija à 2ª Escuta'), '');

  // 4. Paciente na 2ª Escuta sem profissional direcionado NÃO inventa Dr. Israel Christian
  assert.equal(
    sandbox.obterProfissionalSelecionadoSetor('Médico', {
      id: 12,
      setor: 'Acolhimento',
      etapa_fluxo: 'segunda_escuta',
      profissional_destino: null,
      profissional: null,
      medico: null
    }),
    ''
  );

  // 5. Os 4 formulários HTML priorizam d.profissional antes de saved.*
  const recHtml = fs.readFileSync(path.join(root, 'public', 'formularios', 'receituario.html'), 'utf8');
  const espHtml = fs.readFileSync(path.join(root, 'public', 'formularios', 'receituario-controle-especial.html'), 'utf8');
  const labHtml = fs.readFileSync(path.join(root, 'public', 'formularios', 'receituario-exames-laboratoriais.html'), 'utf8');
  const citoHtml = fs.readFileSync(path.join(root, 'public', 'formularios', 'requisicao-exame-citopatologico.html'), 'utf8');

  assert.equal(recHtml.includes("set0('ass', d.profissional||saved.ass||'');"), true);
  assert.equal(espHtml.includes("set0('e_nome', d.profissional || saved.e_nome || '');"), true);
  assert.equal(labHtml.includes("setK('k42', d.profissional||saved.solicitante_lab||saved.ass||'');"), true);
  assert.equal(citoHtml.includes("setInputByLabel('Responsável*', d.profissional || saved.resp_cito || saved.ass || '', 0);"), true);
});

test('Forms remove duplicate Limpar campos button and keep Deixar em Branco', () => {
  const root = path.join(__dirname, '..');
  const formFiles = [
    'receituario.html',
    'receituario-controle-especial.html',
    'receituario-exames-laboratoriais.html',
    'ficha-solicitacao-ambulatorial.html',
    'requisicao-exame-citopatologico.html',
    'declaracao-residencia.html'
  ];
  for (const fname of formFiles) {
    const html = fs.readFileSync(path.join(root, 'public', 'formularios', fname), 'utf8');
    assert.equal(html.includes('Limpar campos'), false, `${fname} should not have duplicate Limpar campos button`);
    assert.equal(html.includes('Deixar em Branco'), true, `${fname} should keep Deixar em Branco button`);
  }
});

test('Previa UI displays Liberado para teste label cleanly', () => {
  const root = path.join(__dirname, '..');
  const indexHtml = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const previaJs = fs.readFileSync(path.join(root, 'public', 'receitas-previa.js'), 'utf8');
  const regJs = fs.readFileSync(path.join(root, 'public', 'regulacao-sisreg.js'), 'utf8');

  assert.equal(indexHtml.includes('Prévia (Liberado para teste)'), true);
  assert.equal(indexHtml.includes('Liberado para teste'), true);
  assert.equal(previaJs.includes('Liberado para teste'), true);
  assert.equal(regJs.includes('Liberado para teste'), true);
});

test('Device identification integrates automatically into internal chat without sector dropdown', () => {
  const root = path.join(__dirname, '..');
  const indexHtml = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  const dispFrontJs = fs.readFileSync(path.join(root, 'public', 'dispositivos.js'), 'utf8');
  const dispBackJs = fs.readFileSync(path.join(root, 'lib', 'dispositivos.js'), 'utf8');

  // Removidos seletores manuais do chat (agora usa apenas cartão automático do dispositivo)
  assert.equal(indexHtml.includes('id="chat-remetente"'), false);
  assert.equal(indexHtml.includes('id="chat-remetente-nome"'), false);
  assert.equal(indexHtml.includes('id="chat-device-id-card"'), true);
  assert.equal(indexHtml.includes('id="disp-bloqueio-sem-nome-card"'), true);

  assert.equal(appJs.includes('CHAT_SETORES_OFICIAIS'), true);
  assert.equal(appJs.includes('sincronizarIdentidadeDispositivoNoChat'), true);
  assert.equal(appJs.includes('obterIdentificacaoRemetenteChat'), true);
  assert.equal(appJs.includes('x-device-id'), true);
  assert.equal(appJs.includes('res.status === 423'), true);

  // registerPresenca, markCanalAsRead e loadAllChannels leem setor de obterIdentificacaoRemetenteChat()
  const matchSetorRefs = appJs.match(/obterIdentificacaoRemetenteChat\(\)\.setor/g) || [];
  assert.equal(matchSetorRefs.length >= 3, true);

  assert.equal(dispFrontJs.includes('const editedId = _dispositivoEdicaoId;'), true);
  assert.equal(dispFrontJs.includes('sincronizarIdentidadeDispositivoNoChat'), true);
  assert.equal(dispFrontJs.includes('alternarBloqueioDispositivosSemNome'), true);
  assert.equal(dispFrontJs.includes('desbloqueioEmergencialAdmin'), true);
  assert.equal(dispBackJs.includes("status === 'sem_nome'"), true);
  assert.equal(dispBackJs.includes('/api/admin/dispositivos/config-bloqueio-sem-nome'), true);
  assert.equal(dispBackJs.includes('ADMIN_DEVICE_UNNAMED'), true);
});

test('SISREG preview bolds [CONFERIR] tags and Escuta modals keep compact wide layout + required IDs', () => {
  const root = path.join(__dirname, '..');
  const indexHtml = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const regJs = fs.readFileSync(path.join(root, 'public', 'regulacao-sisreg.js'), 'utf8');

  // Destaque em negrito e trava de cópia para [CONFERIR] na Regulação e Modal Médico
  assert.equal(indexHtml.includes('id="sm-obs-conferir-box"'), true);
  assert.equal(regJs.includes('id="sr-obs-conferir-box"'), true);
  assert.equal(regJs.includes('REGEX_CONFERIR_SISREG'), true);
  assert.equal(regJs.includes('<mark class="sisreg-conferir-mark"><strong>'), true);
  assert.equal(regJs.includes('confirmarCopiaComConferir'), true);
  assert.equal(regJs.includes('removerMarcacoesConferirSisreg'), true);
  assert.equal(regJs.includes('focarTrechoConferirSisreg'), true);

  // Layout amplo sem rolagem excessiva mantendo todos os IDs usados pelo app.js
  assert.equal(indexHtml.includes('acol-modal-wide'), true);
  assert.equal(indexHtml.includes('acol-modal-wide-lg'), true);
  assert.equal(indexHtml.includes('acol-modal-footer cols-4'), true);
  assert.equal(indexHtml.includes('acol-modal-footer cols-3'), true);
  assert.equal(indexHtml.includes('acol-modal-footer cols-2'), true);

  // Condicoes especiais logo abaixo do motivo/queixa e botao encaminhar dentro do card de direcionamento
  const idxQueixa = indexHtml.indexOf('id="acol-modal-queixa"');
  const idxCond1 = indexHtml.indexOf('id="condicoes-especiais-escuta1"');
  const idxDirTitle = indexHtml.indexOf('🎯 Direcionamento para 2ª Escuta');
  const idxBtnEnc = indexHtml.indexOf('onclick="confirmarEncaminhamento()"');
  const idxFooterCols4 = indexHtml.indexOf('acol-modal-footer cols-4');
  assert.ok(idxQueixa > 0 && idxCond1 > idxQueixa && idxDirTitle > idxCond1);
  assert.ok(idxBtnEnc > idxDirTitle && idxFooterCols4 > idxBtnEnc);

  const requiredEscutaIds = [
    'acol-escuta-modal',
    'acol-modal-patient-info',
    'acol-modal-id',
    'acol-modal-cpf',
    'acol-modal-sus',
    'acol-modal-equipe',
    'acol-modal-queixa',
    'acol-risco-chooser-container',
    'acol-modal-tipo-prof',
    'acol-modal-prof-dest',
    'condicoes-especiais-escuta1',
    'acol-escuta2-modal',
    'acol-escuta2-patient-info',
    'acol-escuta2-id',
    'acol-escuta2-contexto-leitura',
    'acol-escuta2-view-equipe',
    'acol-escuta2-view-motivo1',
    'acol-escuta2-setor-destino',
    'acol-escuta2-prof-destino-grupo',
    'acol-escuta2-prof-destino',
    'acol-escuta2-obs-segunda',
    'acol-escuta2-cpf',
    'acol-escuta2-sus',
    'acol-escuta2-queixa',
    'acol-gravidade-chooser',
    'condicoes-especiais-escuta2',
    'acol-acs-modal',
    'acol-acs-patient-info',
    'acol-acs-patient-id',
    'acol-acs-select'
  ];
  for (const id of requiredEscutaIds) {
    assert.equal(indexHtml.includes(`id="${id}"`), true, `Missing required Escuta element id="${id}"`);
  }
});

test('Global unnamed-device blocking logic enforces 5 safety guards accurately', () => {
  const {
    isNomeDispositivoValido,
    isRotaIsentaBloqueioDispositivo,
    avaliarAcessoDispositivo
  } = require('../lib/dispositivos');

  assert.equal(isNomeDispositivoValido(''), false);
  assert.equal(isNomeDispositivoValido('   '), false);
  assert.equal(isNomeDispositivoValido('Sem nome'), false);
  assert.equal(isNomeDispositivoValido('sem nome'), false);
  assert.equal(isNomeDispositivoValido('Consultório 1'), true);

  // Rotas de TV, QR Code do paciente, login e admin devem sempre ficar isentas
  assert.equal(isRotaIsentaBloqueioDispositivo('GET', '/api/health'), true);
  assert.equal(isRotaIsentaBloqueioDispositivo('GET', '/api/current-calling'), true);
  assert.equal(isRotaIsentaBloqueioDispositivo('GET', '/api/tv/history'), true);
  assert.equal(isRotaIsentaBloqueioDispositivo('GET', '/api/voice-call/pending'), true);
  assert.equal(isRotaIsentaBloqueioDispositivo('POST', '/api/voice-call/99/ack'), true);
  assert.equal(isRotaIsentaBloqueioDispositivo('GET', '/api/tts'), true);
  assert.equal(isRotaIsentaBloqueioDispositivo('GET', '/api/patients/42/status'), true);
  assert.equal(isRotaIsentaBloqueioDispositivo('POST', '/api/auth/login'), true);
  assert.equal(isRotaIsentaBloqueioDispositivo('POST', '/api/verify-admin'), true);
  assert.equal(isRotaIsentaBloqueioDispositivo('POST', '/api/dispositivos/heartbeat'), true);
  assert.equal(isRotaIsentaBloqueioDispositivo('GET', '/api/admin/dispositivos'), true);
  assert.equal(isRotaIsentaBloqueioDispositivo('POST', '/api/admin/dispositivos/config-bloqueio-sem-nome'), true);

  // Rotas operacionais internas sofrem checagem normal
  assert.equal(isRotaIsentaBloqueioDispositivo('GET', '/api/queues'), false);
  assert.equal(isRotaIsentaBloqueioDispositivo('POST', '/api/patients'), false);
  assert.equal(isRotaIsentaBloqueioDispositivo('GET', '/api/chat/canais/geral'), false);

  // 1. Modo restrito DESLIGADO: libera dispositivo sem nome
  assert.deepEqual(
    avaliarAcessoDispositivo({
      deviceId: 'uuid-1',
      dispositivo: { nome: 'Sem nome', ativo: true },
      bloquearSemNome: false,
      isAdmin: false
    }),
    { permitido: true, motivo: null, code: null, error: null }
  );

  // 2. Modo restrito LIGADO + dispositivo COM nome ativo: liberado
  assert.deepEqual(
    avaliarAcessoDispositivo({
      deviceId: 'uuid-2',
      dispositivo: { nome: 'Recepção 1', ativo: true },
      bloquearSemNome: true,
      isAdmin: false
    }),
    { permitido: true, motivo: null, code: null, error: null }
  );

  // 3. Modo restrito LIGADO + dispositivo SEM nome: bloqueado (DEVICE_UNNAMED)
  const resSemNome = avaliarAcessoDispositivo({
    deviceId: 'uuid-3',
    dispositivo: { nome: 'Sem nome', ativo: true },
    bloquearSemNome: true,
    isAdmin: false
  });
  assert.equal(resSemNome.permitido, false);
  assert.equal(resSemNome.motivo, 'sem_nome');
  assert.equal(resSemNome.code, 'DEVICE_UNNAMED');

  // 4. Modo restrito LIGADO + sem deviceId (novo navegador/sem cookie): bloqueado (DEVICE_UNNAMED)
  const resSemId = avaliarAcessoDispositivo({
    deviceId: null,
    dispositivo: null,
    bloquearSemNome: true,
    isAdmin: false
  });
  assert.equal(resSemId.permitido, false);
  assert.equal(resSemId.code, 'DEVICE_UNNAMED');

  // 5. Modo restrito LIGADO + sessão Admin em aparelho sem nome: NÃO tranca Admin
  assert.deepEqual(
    avaliarAcessoDispositivo({
      deviceId: 'uuid-4',
      dispositivo: { nome: 'Sem nome', ativo: true },
      bloquearSemNome: true,
      isAdmin: true
    }),
    { permitido: true, motivo: null, code: null, error: null }
  );

  // 6. Bloqueio manual explícito (ativo = false): bloqueia usuário comum mesmo no modo aberto
  const resBloqManual = avaliarAcessoDispositivo({
    deviceId: 'uuid-5',
    dispositivo: { nome: 'PC Antigo', ativo: false },
    bloquearSemNome: false,
    isAdmin: false
  });
  assert.equal(resBloqManual.permitido, false);
  assert.equal(resBloqManual.motivo, 'bloqueado');
  assert.equal(resBloqManual.code, 'DEVICE_BLOCKED');

  // 7. Bloqueio manual + acesso Admin emergencial: permite recuperar acesso
  assert.deepEqual(
    avaliarAcessoDispositivo({
      deviceId: 'uuid-5',
      dispositivo: { nome: 'PC Antigo', ativo: false },
      bloquearSemNome: false,
      isAdmin: true
    }),
    { permitido: true, motivo: null, code: null, error: null }
  );
});

test('Bloqueio progressivo por tentativas (5 erros -> 5 min -> bloqueio definitivo so Admin desbloqueia)', () => {
  assert.equal(MAX_TENTATIVAS_ANTES_BLOQUEIO, 5);
  assert.equal(DURACAO_BLOQUEIO_TEMP_MS, 5 * 60 * 1000);

  const t0 = 1_700_000_000_000;
  let dev = { ativo: true, tentativas_falhas: 0, bloqueio_etapa: 0, bloqueio_temporario_ate: null, motivo_bloqueio: null };

  for (let i = 1; i <= 4; i++) {
    const f = calcularProximoEstadoFalha(dev, t0 + i * 1000);
    assert.equal(f.action, 'warn');
    assert.equal(f.status, 401);
    assert.equal(f.tentativas_falhas, i);
    assert.equal(f.restantes, 5 - i);
    dev = {
      ...dev,
      tentativas_falhas: f.tentativas_falhas,
      bloqueio_etapa: f.bloqueio_etapa,
      bloqueio_temporario_ate: f.bloqueio_temporario_ate
    };
  }

  // 5o erro consecutivo -> bloqueio temporario de 5 minutos
  const f5 = calcularProximoEstadoFalha(dev, t0 + 5000);
  assert.equal(f5.action, 'temp_lock_5m');
  assert.equal(f5.status, 429);
  assert.equal(f5.bloqueio_etapa, 1);
  assert.equal(f5.retryAfterSec, 300);
  dev = {
    ...dev,
    tentativas_falhas: f5.tentativas_falhas,
    bloqueio_etapa: f5.bloqueio_etapa,
    bloqueio_temporario_ate: f5.bloqueio_temporario_ate,
    motivo_bloqueio: f5.motivo_bloqueio
  };

  // Durante os 5 minutos, continua bloqueado mesmo apos refresh
  const during = calcularEstadoBloqueioAtual(dev, t0 + 60_000);
  assert.equal(during.bloqueioTemporario, true);
  assert.equal(during.bloqueadoDefinitivo, false);

  // Apos expirar os 5 minutos, se errar mais 1 vez -> bloqueio definitivo
  const f6 = calcularProximoEstadoFalha(dev, t0 + 5000 + DURACAO_BLOQUEIO_TEMP_MS + 1000);
  assert.equal(f6.action, 'block_device_permanent');
  assert.equal(f6.status, 423);
  assert.equal(f6.ativo, false);
  assert.equal(f6.bloqueio_etapa, 2);
  assert.equal(f6.motivo_bloqueio, 'excesso_tentativas');
});

test('Bloqueio total após 3 erros no desbloqueio emergencial só libera por outro dispositivo Admin', () => {
  assert.equal(MAX_TENTATIVAS_EMERGENCIA, 3);
  let dev = { ativo: true, tentativas_emergencia: 0, emergencia_bloqueada: false, motivo_bloqueio: null };

  const e1 = calcularProximoEstadoFalhaEmergencia(dev);
  assert.equal(e1.blockedTotal, false);
  assert.equal(e1.status, 403);
  assert.equal(e1.tentativas_emergencia, 1);
  assert.equal(e1.restantes, 2);
  dev = { ...dev, ...e1 };

  const e2 = calcularProximoEstadoFalhaEmergencia(dev);
  assert.equal(e2.blockedTotal, false);
  assert.equal(e2.status, 403);
  assert.equal(e2.tentativas_emergencia, 2);
  assert.equal(e2.restantes, 1);
  dev = { ...dev, ...e2 };

  const e3 = calcularProximoEstadoFalhaEmergencia(dev);
  assert.equal(e3.blockedTotal, true);
  assert.equal(e3.status, 423);
  assert.equal(e3.ativo, false);
  assert.equal(e3.emergencia_bloqueada, true);
  assert.equal(e3.tentativas_emergencia, 3);
  assert.equal(e3.restantes, 0);
  assert.equal(e3.motivo_bloqueio, 'bloqueio_total_emergencia');
  dev = { ...dev, ...e3 };

  const e4 = calcularProximoEstadoFalhaEmergencia(dev);
  assert.equal(e4.blockedTotal, true);
  assert.equal(e4.status, 423);
  assert.equal(e4.emergencia_bloqueada, true);

  const est = calcularEstadoBloqueioAtual(dev);
  assert.equal(est.bloqueadoDefinitivo, true);
  assert.equal(est.emergenciaBloqueada, true);
  assert.equal(est.motivoBloqueio, 'bloqueio_total_emergencia');
});

test('Sala de Agendamento (Admin-only manual), Atendidos e SISREG invariants are enforced', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const serverJs = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const sisregFront = fs.readFileSync(path.join(__dirname, '..', 'public', 'regulacao-sisreg.js'), 'utf8');

  // Sala de Agendamento: registro manual restrito ao Admin no front e back
  assert.match(indexHtml, /id="btn-novo-ctrl-admin"[^>]*class="btn admin-only"|class="btn admin-only"[^>]*id="btn-novo-ctrl-admin"/);
  assert.match(serverJs, /POST \/api\/ctrl-agendamentos[\s\S]{0,600}isManual\s*&&\s*!isValidAdminPass\(senha\)/);
  assert.match(serverJs, /DELETE \/api\/ctrl-agendamentos\/:id[\s\S]{0,400}(?:!isAdminAuthorized\(req\)|!isValidAdminPass\(senha\))/);
  assert.equal(appJs.includes("btoa(senha) !== 'Y2hpY28xMjM='"), false, 'hardcoded base64 check must be removed from exports');
  assert.equal(appJs.includes("pedirSenhaGerenteOuAdmin('Exportar Controle de Agendamentos (Excel/CSV)'") && appJs.includes("pedirSenhaGerenteOuAdmin('Exportar Controle de Agendamentos (PDF)'"), true);
  assert.equal(appJs.includes('abrirModalNovoCtrlAdmin'), true);
  assert.equal(appJs.includes('removerCtrlAgendamento(id, btn)') && appJs.includes("pedirSenhaAdmin('Excluir Registro da Sala de Agendamento'"), true);

  // Atendidos: SQL_ONLY_REAL_ATTEND + deduplicarAtendimentosPorDiaSetor e filtros completos
  const idxHistFiltered = serverJs.indexOf("app.get('/api/history/filtered'");
  assert.ok(idxHistFiltered > 0);
  const histSlice = serverJs.slice(idxHistFiltered, idxHistFiltered + 2200);
  assert.equal(histSlice.includes('SQL_ONLY_REAL_ATTEND') && histSlice.includes('deduplicarAtendimentosPorDiaSetor'), true);
  assert.equal(indexHtml.includes('id="attended-count-manha"'), true);
  assert.equal(indexHtml.includes('id="attended-count-tarde"'), true);
  assert.equal(indexHtml.includes('id="attended-count-prio"'), true);
  assert.equal(indexHtml.includes('id="attended-sector-pills"'), true);
  assert.equal(indexHtml.includes('<option value="Téc. Enfermagem">Téc. Enfermagem</option>'), true);

  // SISREG UI: Exames Lab shortcut + sm-busca-vaga + cache busters
  assert.equal(indexHtml.includes("buscarAtalhoModalSisregMedico('EXAMES DE LABORATORIO')"), true);
  assert.equal(sisregFront.includes("buscarAtalhoSisreg('EXAMES DE LABORATORIO')"), true);
  assert.equal(indexHtml.includes('id="sm-busca-vaga"'), true);
  assert.equal(indexHtml.includes('formularios-pec.js?v=1.9'), true);
  assert.equal(indexHtml.includes('dispositivos.js?v=5.3'), true);
  assert.equal(indexHtml.includes('receitas-previa.js?v=2.0'), true);
  assert.equal(indexHtml.includes('app.js?v=8.5'), true);
  const dispFront = fs.readFileSync(path.join(__dirname, '..', 'public', 'dispositivos.js'), 'utf8');
  assert.equal(dispFront.includes('bloqueio_total_emergencia'), true);
  assert.equal(dispFront.includes('BLOQUEIO TOTAL DO APARELHO'), true);
});

test('Devoluções direcionadas, canal ACS no chat, campo solução, atalhos e PDF estão integrados', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const sisregBack = fs.readFileSync(path.join(__dirname, '..', 'lib', 'sisreg.js'), 'utf8');
  const sisregFront = fs.readFileSync(path.join(__dirname, '..', 'public', 'regulacao-sisreg.js'), 'utf8');
  const formPec = fs.readFileSync(path.join(__dirname, '..', 'public', 'formularios-pec.js'), 'utf8');
  const serverJs = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  assert.match(serverJs, /CANAIS_CHAT\s*=\s*\[[^\]]*'acs'/);
  assert.match(appJs, /id:\s*'acs'/);
  assert.equal(sisregBack.includes('setor_destino') && sisregBack.includes('solucao') && sisregBack.includes('solucao_autor'), true);
  assert.equal(sisregBack.includes('INSERT INTO chat_channels'), true);

  assert.equal(indexHtml.includes('id="modal-devolucoes-profissional"'), true);
  assert.equal(indexHtml.includes("abrirModalDevolucoesProfissional('ACS')"), true);
  assert.equal(formPec.includes('abrirModalDevolucoesProfissional'), true);
  assert.equal(appJs.includes('abrirDevolucaoDoChat') && appJs.includes('abrirDevolucaoRegulacaoDoChat'), true);
  assert.equal(appJs.includes("abrirModalPreviaRegulacao('devolucoes', 'respondida')"), true);

  assert.equal(sisregFront.includes('exportarDevolucoesSisregPDF'), true);
  assert.equal(sisregFront.includes('salvarSolucaoModalProfissional'), true);
  assert.equal(sisregFront.includes('id="dev-setor-destino"'), true);
  assert.equal(sisregFront.includes('id="dev-profissional"'), true);
  assert.equal(sisregFront.includes('Mudou de endereço'), true);
  assert.equal(indexHtml.includes('regulacao-sisreg.js?v=2.1'), true);
  assert.equal(indexHtml.includes('.sisreg-med-modal-backdrop { z-index: 10080; }'), true);

  // Conferência de anexo (lazy-load), apagamento imediato ao corrigir, prazo 3d (+3d adiar) e atalho de busca
  assert.equal(sisregBack.includes('/api/sisreg/devolucoes/:id/anexo'), true);
  assert.equal(sisregBack.includes('/api/sisreg/devolucoes/:id/adiar'), true);
  assert.equal(sisregBack.includes('/api/sisreg/devolucoes/limpar-anexos'), true);
  assert.equal(sisregBack.includes('COLS_DEVOLUCAO_LISTA'), true);
  assert.equal(sisregBack.includes("(anexo_base64 IS NOT NULL) AS tem_anexo"), true);
  assert.equal(sisregBack.includes("CASE WHEN COALESCE($2, status) = 'corrigida' THEN NULL ELSE"), true);
  assert.equal(sisregBack.includes('jaRespondidaMesmaSolucao'), true);
  assert.equal(sisregFront.includes('abrirVisualizadorDevolucao'), true);
  assert.equal(sisregFront.includes('abrirBuscaSisregParaDevolucao'), true);
  assert.equal(sisregFront.includes('adiarPrazoDevolucaoSisreg'), true);
  assert.equal(sisregFront.includes('limparAnexosVencidosSisreg'), true);
  assert.equal(sisregFront.includes('_salvandoSolucaoDevId'), true);
  assert.equal(sisregFront.includes('id="sisreg-resp-badge-bar"'), true);
  assert.equal(sisregFront.includes('id="sisreg-resp-badge"'), true);
  assert.equal(sisregFront.includes('id="sisreg-tab-respondidas"'), true);
  assert.equal(sisregFront.includes('dev-prof-chat-'), true);
  assert.equal(sisregFront.includes('dev-viewer-chat-'), true);
  assert.equal(sisregFront.includes('id="dev-enviar-chat" checked'), false);
  const idxSalvarSol = sisregFront.indexOf('async function salvarSolucaoModalProfissional');
  assert.ok(idxSalvarSol > 0);
  const salvarSlice = sisregFront.slice(idxSalvarSol, idxSalvarSol + 2000);
  assert.equal(salvarSlice.includes('fecharModalDevolucoesProfissional()'), true);
});

test('Dashboard Privado separa Gerente x Admin (Dispositivos só Admin) e mantém hardening', () => {
  const root = path.join(__dirname, '..');
  const serverJs = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const dispBack = fs.readFileSync(path.join(root, 'lib', 'dispositivos.js'), 'utf8');
  const dashHtml = fs.readFileSync(path.join(root, 'public', 'dashboard.html'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

  assert.equal(serverJs.includes("app.get('/api/dashboard/metrics', requireManagerOrAdmin"), true);
  assert.equal(serverJs.includes("app.get('/api/dashboard/hourly', requireManagerOrAdmin"), true);
  assert.equal(serverJs.includes("app.get('/api/dashboard/resumo-operacional', requireManagerOrAdmin"), true);
  assert.equal(serverJs.includes("app.get('/api/dashboard/coletas-semanal', requireManagerOrAdmin"), true);
  assert.equal(serverJs.includes("app.get('/api/dashboard/coletas-manual', requireManagerOrAdmin"), true);
  assert.equal(serverJs.includes("app.post('/api/dashboard/coletas-manual', requireManagerOrAdmin"), true);
  assert.equal(serverJs.includes("app.delete('/api/dashboard/coletas-manual/:id', requireManagerOrAdmin"), true);
  assert.equal(serverJs.includes('let dispositivos = null;'), true);
  assert.equal(dispBack.includes('req.session && req.session.role === \'admin\''), true);

  assert.equal(dashHtml.includes('SETORES_DASH'), true);
  assert.equal(dashHtml.includes('escHtml'), true);
  assert.equal(dashHtml.includes('checkExistingAdminSession'), true);
  assert.equal(dashHtml.includes('logoutDashboard'), true);
  assert.equal(dashHtml.includes('switchDashTab'), true);
  assert.equal(dashHtml.includes('applyDashRoleUI'), true);
  assert.equal(dashHtml.includes('btnExportColetasPDF'), true);
  assert.equal(dashHtml.includes('maxlength="64"'), true);
  assert.equal(dashHtml.includes('tab-prioridades'), true);
  assert.equal(dashHtml.includes('tab-sisreg'), true);
  assert.equal(dashHtml.includes('tab-dispositivos'), true);
  assert.equal(dashHtml.includes('maxlength="10"'), false);
  assert.equal(dashHtml.includes('textContent = "API"'), false);
  assert.equal(indexHtml.includes('admin-strict-only'), true);
  assert.equal(indexHtml.includes('manager-or-admin-tab'), true);
});
