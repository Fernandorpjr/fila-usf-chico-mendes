const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  SESSION_COOKIE_NAME,
  DEFAULT_GATE_HASH,
  LEGACY_ADMIN_HASHES,
  sha256Hex,
  safeEqualStr,
  parseCookies,
  appendSetCookie,
  createSessionToken,
  verifySessionToken,
  isValidGatePass,
  isValidAdminPass,
  isPublicApiRoute,
  getClientIp,
  isRateLimited,
  recordRateLimitHit,
  resetRateLimit,
  checkRateLimit,
  buildCorsOptions
} = require('../lib/seguranca');
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

test('isValidAdminPass validates ADMIN_PASSWORDS via timing-safe comparison and stores only hashes in fallback', () => {
  const prevAdmins = process.env.ADMIN_PASSWORDS;
  try {
    assert.equal(Array.isArray(LEGACY_ADMIN_HASHES), true);
    assert.equal(LEGACY_ADMIN_HASHES.length, 3);
    LEGACY_ADMIN_HASHES.forEach(h => assert.match(h, /^[a-f0-9]{64}$/));

    process.env.ADMIN_PASSWORDS = 'admin-alpha,admin-beta';
    assert.equal(isValidAdminPass('admin-alpha'), true);
    assert.equal(isValidAdminPass('admin-beta'), true);
    assert.equal(isValidAdminPass('admin-gamma'), false);
    assert.equal(isValidAdminPass(''), false);
    assert.equal(safeEqualStr('abc', 'abc'), true);
    assert.equal(safeEqualStr('abc', 'abd'), false);
  } finally {
    if (prevAdmins === undefined) delete process.env.ADMIN_PASSWORDS;
    else process.env.ADMIN_PASSWORDS = prevAdmins;
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

  assert.equal(appJs.includes('GATE_HASH'), false);
  assert.equal(appJs.includes(DEFAULT_GATE_HASH), false);
  assert.equal(serverJs.includes('chico123'), false);
  assert.equal(serverJs.includes('s-maxage=3'), false);
  assert.equal(dispJs.includes('req.query.senha'), false);
  assert.equal(histJs.includes('req.query.senha'), false);
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
