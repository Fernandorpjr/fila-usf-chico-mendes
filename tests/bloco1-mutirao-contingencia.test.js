const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const histSrc = fs.readFileSync(path.join(ROOT, 'lib', 'historico.js'), 'utf8');

const { verifySameOriginMutation } = require('../lib/seguranca');

function extractSlice(src, startMarker, endMarker) {
  const i1 = src.indexOf(startMarker);
  const i2 = src.indexOf(endMarker, i1);
  assert.ok(i1 >= 0, `Start marker missing: ${startMarker}`);
  assert.ok(i2 > i1, `End marker missing: ${endMarker}`);
  return src.slice(i1, i2);
}

test('Bloco 1 (CSRF): verifySameOriginMutation libera origem oficial/mesmo host e bloqueia origem externa', () => {
  assert.deepEqual(
    verifySameOriginMutation({ method: 'GET', headers: { origin: 'https://evil.example.com' } }),
    { ok: true }
  );
  assert.deepEqual(
    verifySameOriginMutation({ method: 'POST', headers: {} }),
    { ok: true }
  );
  assert.deepEqual(
    verifySameOriginMutation({ method: 'POST', headers: { origin: 'https://fila-usf-chico-mendes.vercel.app' } }),
    { ok: true }
  );
  assert.deepEqual(
    verifySameOriginMutation({
      method: 'PUT',
      headers: {
        origin: 'https://fila-preview-123.vercel.app',
        'x-forwarded-host': 'fila-preview-123.vercel.app',
        'x-forwarded-proto': 'https'
      }
    }),
    { ok: true }
  );
  const blocked = verifySameOriginMutation({
    method: 'DELETE',
    headers: {
      origin: 'https://phishing-externo.example.com',
      host: 'fila-usf-chico-mendes.vercel.app'
    }
  });
  assert.equal(blocked.ok, false);
});

test('Bloco 1 (Segurança/LGPD/Idempotência): backend protege rotas, valida entradas e limpa campos clínicos antigos', () => {
  // Middleware anti-CSRF ativo no /api
  assert.equal(serverSrc.includes('verifySameOriginMutation(req)'), true);

  // Idempotência e validação em POST /api/patients
  assert.equal(serverSrc.includes('idx_patients_client_req_id'), true);
  assert.equal(serverSrc.includes('client_request_id'), true);
  assert.equal(serverSrc.includes('SETORES.includes(setor)'), true);
  assert.equal(serverSrc.includes("error: 'Setor informado é inválido.'"), true);

  // Rate limit nas rotas críticas e projeção LGPD no pending_voice_calls
  assert.equal(serverSrc.includes("checkRateLimit('auth_login_ip'"), true);
  assert.equal(serverSrc.includes("checkRateLimit('verify_admin_ip'"), true);
  assert.equal(serverSrc.includes("checkRateLimit('voice_call_ip'"), true);
  const idxVoicePending = serverSrc.indexOf("app.get('/api/voice-call/pending'");
  const voiceSlice = serverSrc.slice(idxVoicePending, idxVoicePending + 400);
  assert.equal(voiceSlice.includes('SELECT id, nome, setor, destino, created_at'), true);
  assert.equal(voiceSlice.includes('SELECT * FROM pending_voice_calls'), false);

  // RBAC Gerente/Admin em /api/profissionais e /api/responsaveis-setor
  assert.equal(serverSrc.includes("app.post('/api/profissionais', requireManagerOrAdmin"), true);
  assert.equal(serverSrc.includes("app.put('/api/profissionais/:id', requireManagerOrAdmin"), true);
  assert.equal(serverSrc.includes("app.delete('/api/profissionais/:id', requireManagerOrAdmin"), true);
  assert.equal(serverSrc.includes("app.post('/api/responsaveis-setor', requireManagerOrAdmin"), true);
  assert.equal(serverSrc.includes("app.put('/api/responsaveis-setor/:id', requireManagerOrAdmin"), true);
  assert.equal(serverSrc.includes("app.delete('/api/responsaveis-setor/:id', requireManagerOrAdmin"), true);

  // Logs de auditoria em ações críticas e transação em encaminhar acolhimento
  assert.equal(serverSrc.includes("acao: 'DESISTENCIA'"), true);
  assert.equal(serverSrc.includes("acao: 'RESET_DIARIO'"), true);
  assert.equal(serverSrc.includes("acao: 'EXCLUIR_PACIENTE'"), true);
  assert.equal(serverSrc.includes("acao: 'EXCLUIR_HISTORICO'"), true);
  const idxEnc = serverSrc.indexOf("app.put('/api/acolhimento/:id/encaminhar'");
  const encSlice = serverSrc.slice(idxEnc, idxEnc + 1200);
  assert.equal(encSlice.includes("await client.query('BEGIN')"), true);
  assert.equal(encSlice.includes('FOR UPDATE'), true);

  // Limpeza automática LGPD (7 dias para CPF/CNS/queixas em call_history)
  assert.equal(histSrc.includes('SET cpf = NULL,'), true);
  assert.equal(histSrc.includes("INTERVAL '7 days'"), true);
});

test('Mutirão Dinâmico: filtra profissionais só-mutirão (Renata Célia) na semana e libera no sábado/mutirão', () => {
  const fnSlice = extractSlice(
    appSrc,
    'function filtrarListaProfissionaisAtivos(',
    'function atualizarSelectPreservandoValor('
  );
  const ctx = {
    _PROFISSIONAIS_FALLBACK: {
      'Médico': ['Dr. Israel Christian'],
      'Enfermagem': ['Mariana Vaz', 'Jorge Marcio', 'Lucelia de Abreu', 'Renata Célia'],
      'Odontologia': ['Dra. Juliana Cavalcante'],
      'Téc. Enfermagem': ['Viviane', 'Vilma', 'Fernando']
    },
    isContextoMutiraoAtivoFront: () => false
  };
  vm.runInNewContext(fnSlice, ctx);

  const lista = [
    { nome: 'Mariana Vaz', setor: 'Enfermagem', regime: 'fixo', ativo: true },
    { nome: 'Jorge Marcio', setor: 'Enfermagem', regime: 'fixo', ativo: true },
    { nome: 'Renata Célia', setor: 'Enfermagem', regime: 'mutirao', ativo: true },
    { nome: 'Dra. Substituta', setor: 'Médico', regime: 'substituto', ativo: true },
    { nome: 'Prof Inativo', setor: 'Médico', regime: 'fixo', ativo: false }
  ];

  // Dia normal de semana: Renata Célia não polui a fila, mas aparece nos selects gerais/agendamento
  const resSemana = JSON.parse(JSON.stringify(ctx.filtrarListaProfissionaisAtivos(lista, false)));
  assert.deepEqual(resSemana.porSetorAtendimento['Enfermagem'], ['Mariana Vaz', 'Jorge Marcio']);
  assert.equal(resSemana.porSetorTodosAtivos['Enfermagem'].includes('Renata Célia'), true);
  assert.equal(resSemana.porSetorAtendimento['Médico'].includes('Dra. Substituta'), true);
  assert.equal(resSemana.porSetorTodosAtivos['Médico'].includes('Prof Inativo'), false);

  // Sábado / Mutirão Ativo: Renata Célia aparece automaticamente nas filas
  const resMutirao = JSON.parse(JSON.stringify(ctx.filtrarListaProfissionaisAtivos(lista, true)));
  assert.deepEqual(resMutirao.porSetorAtendimento['Enfermagem'], ['Mariana Vaz', 'Jorge Marcio', 'Renata Célia']);

  // UI e modal presentes no index.html
  assert.equal(indexHtml.includes('id="modal-equipe-mutirao"'), true);
  assert.equal(indexHtml.includes('abrirModalEquipeMutirao()'), true);
});

test('Contingência Offline: ofusca espelho local, remove dados clínicos (LGPD), limpa no logout e gera folha imprimível', () => {
  const slice = extractSlice(
    appSrc,
    '// --- Contingência Offline LGPD',
    'async function sincronizarFilaOfflinePendente'
  ) + '\n' + extractSlice(
    appSrc,
    'function limparEspelhoContingenciaLogout(',
    'function renderModalContingenciaOffline('
  ) + '\n' + extractSlice(
    appSrc,
    'function gerarHtmlFolhaContingencia(',
    'window.addEventListener(\'online\''
  );

  const localStore = new Map();
  const sessStore = new Map();
  let mockQueues = {
    'Médico': [
      {
        id: 101,
        nome: 'Maria das Dores',
        setor: 'Médico',
        profissional: 'Dr. Israel Christian',
        prioridade: 'prioritario',
        tipo_prioridade: '9. Idoso 60+',
        nivel_prioridade: 2,
        horario: '09:15',
        cpf: '123.456.789-00',
        cartao_sus: '700000000000001',
        queixa: 'Dor torácica intensa',
        exames_coleta: { exames: ['GLI'] }
      }
    ],
    'Enfermagem': []
  };

  const ctx = {
    document: { getElementById: () => null },
    SETORES: ['Médico', 'Enfermagem'],
    queues: mockQueues,
    acolhimentoFluxo: { recepcao: [], primeira_escuta: [], segunda_escuta: [] },
    currentCalling: {},
    localStorage: {
      getItem: k => (localStore.has(k) ? localStore.get(k) : null),
      setItem: (k, v) => localStore.set(k, String(v)),
      removeItem: k => localStore.delete(k)
    },
    sessionStorage: {
      getItem: k => (sessStore.has(k) ? sessStore.get(k) : null),
      setItem: (k, v) => sessStore.set(k, String(v)),
      removeItem: k => sessStore.delete(k)
    },
    getDataHojeRecife: () => '2026-11-25',
    escapeText: (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    updateAll: () => {},
    renderAcolhimentoFluxo: () => {},
    showToast: () => {},
    TextEncoder,
    TextDecoder,
    btoa: (str) => Buffer.from(str, 'binary').toString('base64'),
    atob: (b64) => Buffer.from(b64, 'base64').toString('binary'),
    Date,
    Math
  };
  vm.runInNewContext(slice, ctx);

  // 1. Espelho criptografado/ofuscado não salva texto claro nem campos clínicos LGPD
  ctx.salvarEspelhoFilaContingencia();
  const cipher = localStore.get('usf_contingencia_espelho_v1');
  assert.ok(cipher && cipher.length > 10);
  assert.equal(cipher.includes('Maria das Dores'), false, 'Nome não deve ficar em texto claro no localStorage');
  assert.equal(cipher.includes('123.456.789-00'), false);

  const lido = ctx.lerEspelhoFilaContingencia();
  assert.equal(lido.queues['Médico'].length, 1);
  const pacEspelho = lido.queues['Médico'][0];
  assert.equal(pacEspelho.nome, 'Maria das Dores');
  assert.equal(pacEspelho.cpf, undefined, 'CPF deve ser removido do espelho LGPD');
  assert.equal(pacEspelho.cartao_sus, undefined, 'CNS deve ser removido do espelho LGPD');
  assert.equal(pacEspelho.queixa, undefined, 'Queixa clínica deve ser removida do espelho LGPD');
  assert.equal(pacEspelho.exames_coleta, undefined, 'Exames devem ser removidos do espelho LGPD');

  // 2. Enfileiramento offline + restauração em queda de internet
  ctx.enfileirarPacienteOffline({
    nome: 'José Pereira',
    setor: 'Enfermagem',
    profissional: 'Renata Célia',
    prioridade: 'geral',
    client_request_id: 'req_offline_teste_1'
  }, 'Enfermagem');
  assert.equal(ctx.queues['Enfermagem'].length, 1);
  assert.equal(ctx.queues['Enfermagem'][0].offline_pendente, true);

  // 3. Folha impressa de contingência contém pacientes na ordem + campos de marcação
  const html = ctx.gerarHtmlFolhaContingencia({ queues: ctx.queues });
  assert.equal(html.includes('Maria das Dores'), true);
  assert.equal(html.includes('José Pereira [OFFLINE]'), true);
  assert.equal(html.includes('Dr. Israel Christian'), true);
  assert.equal(html.includes('Renata Célia'), true);
  assert.equal(html.includes('Dor torácica'), false, 'Folha impressa de fila não expõe queixa clínica');

  // 4. Logout apaga espelho, outbox e chave de sessão
  ctx.limparEspelhoContingenciaLogout(true);
  assert.equal(localStore.has('usf_contingencia_espelho_v1'), false);
  assert.equal(localStore.has('usf_contingencia_outbox_v1'), false);
  assert.equal(sessStore.has('usf_contingencia_k1'), false);

  // 5. Botões e modal no index.html
  assert.equal(indexHtml.includes('id="modal-contingencia-offline"'), true);
  assert.equal(indexHtml.includes('imprimirFolhaContingenciaFila()'), true);
  assert.equal(indexHtml.includes('id="contingencia-offline-badge"'), true);
});
