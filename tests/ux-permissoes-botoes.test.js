const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const formsSrc = fs.readFileSync(path.join(ROOT, 'public', 'formularios-pec.js'), 'utf8');
const previaSrc = fs.readFileSync(path.join(ROOT, 'public', 'receitas-previa.js'), 'utf8');

function extractSlice(src, startMarker, endMarker) {
  const i1 = src.indexOf(startMarker);
  const i2 = endMarker ? src.indexOf(endMarker, i1) : src.length;
  assert.ok(i1 >= 0, `Start marker missing: ${startMarker}`);
  assert.ok(i2 > i1, `End marker missing: ${endMarker}`);
  return src.slice(i1, i2);
}

test('RBAC Backend: rename, prioridade e Pedir Silêncio são exclusivos de Gerente/Admin', () => {
  const renameRoute = extractSlice(serverSrc, "app.put('/api/patients/:id/rename'", "app.put('/api/patients/:id/prioridade'");
  assert.equal(renameRoute.includes('isManagerOrAdminAuthorized(req)'), true);
  assert.equal(renameRoute.includes('resolvePrivilegedRole('), true);
  assert.equal(renameRoute.includes('requiresManagerPassword: true'), true);
  assert.equal(renameRoute.includes('res.status(403)'), true);

  const prioRoute = extractSlice(serverSrc, "app.put('/api/patients/:id/prioridade'", "app.put('/api/patients/:id/exames-coleta'");
  assert.equal(prioRoute.includes('isManagerOrAdminAuthorized(req)'), true);
  assert.equal(prioRoute.includes('resolvePrivilegedRole('), true);
  assert.equal(prioRoute.includes('requiresManagerPassword: true'), true);
  assert.equal(prioRoute.includes('rankNovo > rankAntes'), false);

  const voiceRoute = extractSlice(serverSrc, "app.post('/api/voice-call'", "app.get('/api/voice-call/pending'");
  assert.equal(voiceRoute.includes("'__AVISO_SILENCIO__'"), true);
  assert.equal(voiceRoute.includes('isManagerOrAdminAuthorized(req)'), true);
  assert.equal(voiceRoute.includes('resolvePrivilegedRole('), true);
  assert.equal(voiceRoute.includes('res.status(403)'), true);

  // Rotas operacionais não afetadas mantêm autenticação normal de equipe
  const ausenteRoute = extractSlice(serverSrc, "app.put('/api/patients/:id/ausente-temporario'", "app.get('/api/admin/auditoria-fila'");
  assert.equal(ausenteRoute.includes('!req.session && !isManagerOrAdminAuthorized(req)'), true);

  const enviarFilaRoute = extractSlice(serverSrc, "app.post('/api/agendamentos/:id/enviar-fila'", "const agRes = await client.query('SELECT * FROM agendamentos");
  assert.equal(enviarFilaRoute.includes('!req.session && !isManagerOrAdminAuthorized(req)'), true);
});

test('RBAC Frontend: Pedir Silêncio, Editar Nome e Editar Prioridade ocultos e bloqueados fora de Gerente/Admin', () => {
  // Recepção não possui mais botão Pedir Silêncio
  const recepcaoSlice = extractSlice(indexHtml, 'id="screen-recepcao"', 'id="recepcao-top-grid"');
  assert.equal(recepcaoSlice.includes('solicitarSilencioSalaEspera'), false);

  // Barra admin e painel TV restringem Pedir Silêncio a manager-or-admin-tab (oculto por padrão)
  assert.equal(indexHtml.includes('id="btn-pedir-silencio-admin"'), true);
  assert.equal(indexHtml.includes('id="btn-pedir-silencio-painel"'), true);
  const painelSlice = extractSlice(indexHtml, 'id="btn-pedir-silencio-painel"', '</div>');
  assert.equal(painelSlice.includes('manager-or-admin-tab'), true);
  assert.equal(painelSlice.includes('display:none;'), true);

  // Guardas JS nas funções de silêncio, editar nome e editar prioridade
  const silenceFn = extractSlice(appSrc, 'async function solicitarSilencioSalaEspera', 'function getRealCallsFromHistory');
  assert.equal(silenceFn.includes('if (!isManagerOrAdmin())'), true);

  const editModalFns = extractSlice(appSrc, 'function abrirModalEditarNomeFila(', 'function calcularRankPrevioFront(');
  assert.equal(editModalFns.includes('if (!isManagerOrAdmin())'), true);

  const prioModalFns = extractSlice(appSrc, 'function abrirModalPrioridadePorId(', 'function gerarHtmlPillsTubos(');
  assert.equal(prioModalFns.includes('if (!isManagerOrAdmin())'), true);

  const ctxSlice = extractSlice(appSrc, 'function openContextMenu(', 'function openPositionModal(');
  assert.equal(ctxSlice.includes("'ctx-item-rename', 'ctx-item-priority', 'ctx-divider-mgr'"), true);
  assert.equal(ctxSlice.includes('if (!isManagerOrAdmin())'), true);

  // Renderizadores da fila protegem renameBtn e prioEditBtn com isManagerOrAdmin()
  const queueRowSlice = extractSlice(appSrc, 'const ehPrioAtivo =', 'const rowCls = [');
  assert.equal(queueRowSlice.includes('const renameBtn = isManagerOrAdmin()'), true);
  assert.equal(queueRowSlice.includes('const prioEditBtn = (isManagerOrAdmin()'), true);
  assert.equal(queueRowSlice.includes('fila-reorder-pill'), true);

  const miniRowSlice = extractSlice(appSrc, 'const ehPrioMini =', 'const rowCls = [');
  assert.equal(miniRowSlice.includes('const renameBtnMini = isManagerOrAdmin()'), true);
  assert.equal(miniRowSlice.includes('const prioEditBtnMini = isManagerOrAdmin()'), true);

  const acolSlice = extractSlice(appSrc, 'function renderAcolhimentoFluxo', 'function filtrarAcolhimento(');
  assert.equal(acolSlice.includes('editarNomeAcolhimento('), false);
  assert.equal(acolSlice.includes('const acolMgrBtns = isManagerOrAdmin()'), true);
});

test('Organização da Barra Gerente/Admin: categorias visuais, selo de perfil e botões semânticos', () => {
  const toolbarSlice = extractSlice(indexHtml, '<div class="admin-toolbar" id="admin-toolbar">', '</header>');
  assert.equal(toolbarSlice.includes('admin-role-admin'), true);
  assert.equal(toolbarSlice.includes('admin-role-manager'), true);
  assert.equal(toolbarSlice.includes('Operação &amp; Sala'), true);
  assert.equal(toolbarSlice.includes('Áudio &amp; TV'), true);
  assert.equal(toolbarSlice.includes('Gestão &amp; Equipe'), true);
  assert.equal(toolbarSlice.includes('Sistema'), true);
  assert.equal(toolbarSlice.includes('admin-cat-pod--system'), true);
  assert.equal(toolbarSlice.includes('admin-tb-btn--amber'), true);
  assert.equal(toolbarSlice.includes('admin-tb-btn--teal'), true);
  assert.equal(toolbarSlice.includes('admin-tb-btn--warn'), true);
  assert.equal(toolbarSlice.includes('admin-tb-btn--blue'), true);
  assert.equal(toolbarSlice.includes('admin-tb-btn--danger'), true);
});

test('Organização dos Botões dos Médicos: deck padronizado, formulários agrupados e popover na linha', () => {
  const sectorInitSlice = extractSlice(appSrc, 'function initSectorScreens()', 'function initOverview()');
  assert.equal(sectorInitSlice.includes('priority-rule-collapse'), true);
  assert.equal(sectorInitSlice.includes('sector-control-deck'), true);
  assert.equal(sectorInitSlice.includes('sector-call-row'), true);
  assert.equal(sectorInitSlice.includes('sector-call-actions'), true);
  assert.equal(sectorInitSlice.includes('btn-repeat-sector'), true);

  const formsBarSlice = extractSlice(formsSrc, 'function renderBarraFormulariosSetor(', 'function abrirSisregDoFormulario(');
  assert.equal(formsBarSlice.includes('clinical-tools-deck'), true);
  assert.equal(formsBarSlice.includes('clinical-tools-zone'), true);
  assert.equal(formsBarSlice.includes('clinical-quick-row'), true);
  assert.equal(formsBarSlice.includes('clinical-forms-grid'), true);
  assert.equal(formsBarSlice.includes('togglePainelFormulariosSetor'), true);

  const rowFormsSlice = extractSlice(formsSrc, 'function abrirMenuFormulariosPaciente(', '');
  assert.equal(rowFormsSlice.includes('btn-fila-forms-trigger'), true);
  assert.equal(rowFormsSlice.includes('fila-forms-popover'), true);
  assert.equal(rowFormsSlice.includes('abrirFormularioPacienteFila('), true);

  // Tag compacta mantém 'Liberado para teste' no title (compatibilidade LGPD/testes)
  assert.equal(previaSrc.includes('title="Liberado para teste">Teste</span>'), true);
});

test('Correções de falhas: Pedir Silêncio sem duplicidade, fim da repetição de voz, ETag real e expediente 18h', () => {
  // 1. Expediente do servidor alinhado para 18h, desempate por id DESC no histórico e janela de 90s para avisos pendentes
  assert.equal(serverSrc.includes('if (hour < 6 || hour >= 18) return false;'), true);
  assert.equal(serverSrc.includes('if (hour < 6 || hour >= 20) return false;'), false);
  assert.equal(serverSrc.includes("ORDER BY created_at AT TIME ZONE 'America/Sao_Paulo' DESC, id DESC"), true);
  assert.equal(serverSrc.includes("AND created_at >= NOW() - INTERVAL '90 seconds'"), true);

  // 2. Rechamar restaura status='chamado' para ausente temporário
  const rechamarSlice = extractSlice(serverSrc, "app.post('/api/patients/:id/rechamar'", '// ====== MELHORIA G');
  assert.equal(rechamarSlice.includes("THEN 'chamado' ELSE status END"), true);

  // 3. ETag real no window.fetch sem ?_t=
  const fetchSlice = extractSlice(appSrc, 'window.fetch = function(resource, config)', 'const GATE_EXPIRY_MS');
  assert.equal(fetchSlice.includes("nextConfig.cache = 'no-cache'"), true);
  assert.equal(fetchSlice.includes('_t=${Date.now()}'), false);

  // 4. loadHistory sem regressão de ponteiro nem leitura retroativa do dia inteiro
  const histSlice = extractSlice(appSrc, 'async function loadHistory()', 'async function loadAttended()');
  assert.equal(histSlice.includes('if (reqSeq < _historySeq) return;'), true);
  assert.equal(histSlice.includes('_spokenCallIds.has(pid)'), true);
  assert.equal(histSlice.includes('Math.max(prevMaxId, maxId)'), true);

  // Removido lastSpokenCallId = 0 forçado em callNext / chamarNoPainel / chamarSegundaEscutaPaciente
  const callNextSlice = extractSlice(appSrc, 'async function callNext(', 'async function callNextMulti(');
  assert.equal(callNextSlice.includes('lastSpokenCallId = 0'), false);

  // 5. Pedir Silêncio não toca 2x na TV e usa trava/deduplicação em loadPendingVoiceCalls
  const silenceFn = extractSlice(appSrc, 'async function solicitarSilencioSalaEspera', 'function getRealCallsFromHistory');
  assert.equal(silenceFn.includes('_processedVoiceCallIds.add'), true);
  assert.equal(silenceFn.includes("headers['x-admin-password']"), true);

  const pendingVoiceSlice = extractSlice(appSrc, 'async function loadPendingVoiceCalls()', '// === FIM MELHORIA 4 ===');
  assert.equal(pendingVoiceSlice.includes('if (_loadingPendingVoiceCalls) return;'), true);
  assert.equal(pendingVoiceSlice.includes('_processedVoiceCallIds.has(cid)'), true);

  // 6. Scroll listener do popover não usa captura global irrestrita
  const popListenersSlice = extractSlice(formsSrc, 'function garantirListenersPopoverFormularios()', 'function abrirMenuFormulariosPaciente(');
  assert.equal(popListenersSlice.includes('addEventListener(\'scroll\', fecharMenuFormulariosPaciente, true)'), false);
});

test('Broadcast multi-TV do Pedir Silêncio e Botão Hero Chamar Próximo em destaque', () => {
  // Backend grava aviso_silencio_ultimo em configuracoes, entrega via current-calling e não consome broadcast no /ack
  assert.equal(serverSrc.includes("'aviso_silencio_ultimo'"), true);
  assert.equal(serverSrc.includes('avisoSilencio'), true);
  assert.equal(serverSrc.includes('AVISOS_INSTITUCIONAIS_TOKENS'), true);
  assert.equal(serverSrc.includes("AND created_at >= NOW() - INTERVAL '60 seconds'"), true);
  assert.equal(serverSrc.includes("WHERE id = $1 AND nome <> '__AVISO_SILENCIO__' AND NOT (nome = ANY($2::text[]))"), true);

  // Frontend não dá ack em __AVISO_SILENCIO__ e processa broadcast em loadCurrentCalling + loadPendingVoiceCalls
  const silenceFn = extractSlice(appSrc, 'async function solicitarSilencioSalaEspera', 'function getRealCallsFromHistory');
  assert.equal(silenceFn.includes('/ack'), false);
  assert.equal(appSrc.includes('function processarAvisoSilencioRemoto('), true);
  const currentCallingFn = extractSlice(appSrc, 'async function loadCurrentCalling()', 'async function loadHistory()');
  assert.equal(currentCallingFn.includes('processarAvisoSilencioRemoto(d.avisoSilencio)'), true);

  // Botão Hero Chamar Próximo em destaque na UI e no CSS
  const sectorInitSlice = extractSlice(appSrc, 'function initSectorScreens()', 'function initOverview()');
  assert.equal(sectorInitSlice.includes('sector-call-actions--hero'), true);
  assert.equal(sectorInitSlice.includes('btn-call-hero'), true);
  assert.equal(indexHtml.includes('.btn-call-hero {'), true);
  assert.equal(indexHtml.includes('min-height: 58px;'), true);
  assert.equal(indexHtml.includes('font-size: 18px;'), true);
});

test('Formulário PEC Offline: Ficha de Registro Tardio SOAP com timbre Prefeitura do Recife nas abas Médico, Enfermagem e Odontologia', () => {
  const soapPath = path.join(ROOT, 'public', 'formularios', 'registro-tardio-soap.html');
  assert.equal(fs.existsSync(soapPath), true);
  const soapHtml = fs.readFileSync(soapPath, 'utf8');

  // Timbre oficial Prefeitura do Recife + SUS + USF (idêntico ao brasão do receituário)
  const recHtml = fs.readFileSync(path.join(ROOT, 'public', 'formularios', 'receituario.html'), 'utf8');
  const mRec = recHtml.match(/src="(data:image\/jpeg;base64,[^"]+)"/);
  const mSoap = soapHtml.match(/src="(data:image\/jpeg;base64,[^"]+)"/);
  assert.ok(mRec && mSoap && mSoap[1] === mRec[1], 'Brasão da Prefeitura do Recife deve ser idêntico ao oficial do receituário');
  assert.equal(soapHtml.includes('Secretaria de Saúde do Recife'), true);
  assert.equal(soapHtml.includes('PREFEITURA DO RECIFE'), true);
  assert.equal(soapHtml.includes('data:image/jpeg;base64,'), true);
  assert.equal(soapHtml.includes('SUS'), true);
  assert.equal(soapHtml.includes('US 177 USF CHICO MENDES'), true);

  // Estrutura fiel ao MODELO_FICHA_DE_REGISTRO_TARDIO_SOAP.docx
  const obrigatorios = [
    'REGISTRO DE ATENDIMENTO',
    'HORA DO ATENDIMENTO',
    'CNS / CPF',
    'SUBJETIVO',
    'OBJETIVO',
    'SINAIS VITAIS',
    'GESTANTE',
    'PRESSÃO ARTERIAL',
    'TEMPERATURA',
    'GLICEMIA',
    'EXAMES AVALIADOS',
    'AVALIAÇÃO',
    'PROBLEMA E/OU CONDIÇÃO AVALIADA',
    'PLANO',
    'INTERVENÇÃO OU PROCEDIMENTOS CLÍNICOS',
    'SOLICITAÇÕES DE EXAMES',
    'PRESCRIÇÃO DE MEDICAMENTOS',
    'TIPO DE ATENDIMENTO',
    'CONSULTA NO DIA',
    'URGÊNCIA',
    'TIPO DE CONSULTA',
    '1ª CONSULTA',
    'CONSULTA DE RETORNO',
    'CONSULTA DE MANUTENÇÃO',
    'CONDUTA',
    'RETORNO PARA CONSULTA',
    'AGENDAMENTO PARA OUTROS PROFISSIONAIS AB',
    'AGENDAMENTO PARA NASF',
    'ALTA DO EPISÓDIO',
    'AGENDAMENTOS PARA GRUPOS',
    'Assinatura do Profissional Responsável'
  ];
  for (const item of obrigatorios) {
    assert.equal(soapHtml.includes(item), true, `Campo/seção ausente no SOAP HTML: ${item}`);
  }

  // Contrato postMessage
  assert.equal(soapHtml.includes("form:'registro-soap'"), true);
  assert.equal(soapHtml.includes("'FORM_PREENCHER'"), true);
  assert.equal(soapHtml.includes("'FORM_BRANCO'"), true);
  assert.equal(soapHtml.includes("'FORM_IMPRIMIR'"), true);

  // Integração restrita a Médico, Enfermagem e Odontologia em formularios-pec.js
  assert.equal(formsSrc.includes("'registro-soap'"), true);
  assert.equal(formsSrc.includes('/formularios/registro-tardio-soap.html?v=1.0'), true);
  const setoresSlice = extractSlice(formsSrc, 'const FORMULARIOS_POR_SETOR = {', 'const FORMULARIOS_LINHA_FILA = {');
  for (const setor of ["'Médico':", "'Enfermagem':", "'Odontologia':"]) {
    const linha = setoresSlice.split('\n').find(l => l.includes(setor)) || '';
    assert.equal(linha.includes("'registro-soap'"), true, `${setor} deve incluir registro-soap em FORMULARIOS_POR_SETOR`);
  }
  for (const setorRestrito of ["'Recepção':", "'ACS':", "'Regulação':", "'Acolhimento':", "'Farmácia':", "'Téc. Enfermagem':"]) {
    const linha = setoresSlice.split('\n').find(l => l.includes(setorRestrito)) || '';
    assert.equal(linha.includes("'registro-soap'"), false, `${setorRestrito} não deve incluir registro-soap`);
  }

  const linhaFilaSlice = extractSlice(formsSrc, 'const FORMULARIOS_LINHA_FILA = {', 'let _foEstadoAtual = {');
  for (const setor of ["'Médico':", "'Enfermagem':", "'Odontologia':"]) {
    const linha = linhaFilaSlice.split('\n').find(l => l.includes(setor)) || '';
    assert.equal(linha.includes("'registro-soap'"), true, `${setor} deve incluir registro-soap no popover da fila`);
  }

  // Botões no modal e na prévia em index.html
  assert.equal(indexHtml.includes('id="fo-tab-registro-soap"'), true);
  assert.equal(indexHtml.includes('id="vp-btn-form-soap"'), true);
});

test('Correção definitiva Pedir Silêncio + 2 Novos Avisos TV + Auditoria Geral (Dashboard, Dispositivos, Histórico CSV e SQL)', () => {
  const dashHtml = fs.readFileSync(path.join(ROOT, 'public', 'dashboard.html'), 'utf8');
  const dispFront = fs.readFileSync(path.join(ROOT, 'public', 'dispositivos.js'), 'utf8');
  const histBack = fs.readFileSync(path.join(ROOT, 'lib', 'historico.js'), 'utf8');
  const histFront = fs.readFileSync(path.join(ROOT, 'public', 'historico.js'), 'utf8');

  // 1. Três avisos institucionais na barra Admin, na TV e no Dashboard
  for (const tok of ['__AVISO_SILENCIO__', '__AVISO_DOCUMENTOS__', '__AVISO_AGUARDE_PAINEL__']) {
    assert.equal(serverSrc.includes(tok), true, `Token ausente no backend: ${tok}`);
    assert.equal(appSrc.includes(tok), true, `Token ausente em app.js: ${tok}`);
    assert.equal(dashHtml.includes(tok), true, `Token ausente em dashboard.html: ${tok}`);
  }
  for (const btnId of [
    'btn-pedir-silencio-admin',
    'btn-aviso-documentos-admin',
    'btn-aviso-painel-admin',
    'btn-pedir-silencio-painel',
    'btn-aviso-documentos-painel',
    'btn-aviso-painel-painel'
  ]) {
    assert.equal(indexHtml.includes(`id="${btnId}"`), true, `Botão ausente em index.html: ${btnId}`);
  }

  // 2. Recuperação de sessão/senha em Pedir Silêncio Admin, sem sujar cache local quando fora da TV e proteção contra clock skew
  const silenceFn = extractSlice(appSrc, 'async function solicitarSilencioSalaEspera', 'function getRealCallsFromHistory');
  assert.equal(silenceFn.includes('pedirSenhaGerenteOuAdmin'), true);
  assert.equal(silenceFn.includes('if (ehTelaTvLocal)'), true);
  assert.equal(serverSrc.includes('EXTRACT(EPOCH FROM (NOW() - created_at))'), true);
  assert.equal(serverSrc.includes("res.setHeader('Cache-Control', 'no-cache, must-revalidate')"), true);
  assert.equal(serverSrc.includes('const privRole = resolvePrivilegedRole(senha);'), true);
  assert.equal(appSrc.includes('Array.isArray(ttsData.audioSegments)'), true);

  // 3. Correções da auditoria geral
  assert.equal(dashHtml.includes('id="btnTabDevices"'), true);
  assert.equal(dashHtml.includes('/auth/downgrade-staff'), true);
  assert.equal(dashHtml.includes("roleBadge.style.display = currentDashRole ? 'inline-flex' : 'none'"), true);

  assert.equal(dispFront.includes('if (!isAdmin || !adminPassword)'), false);
  assert.equal(dispFront.includes('function _adminDispHeaders('), true);

  const ausenteSlice = extractSlice(serverSrc, "app.put('/api/patients/:id/ausente-temporario'", "app.get('/api/admin/auditoria-fila'");
  assert.equal(ausenteSlice.includes('FROM unnest($1::int[], $2::int[])'), true);
  assert.equal(ausenteSlice.includes('for (let i = 0; i < ids.length; i++)'), false);

  assert.equal(histBack.includes('function montarFiltrosHistoricoQuery('), true);
  assert.equal(histFront.includes('function montarParamsFiltroHistorico('), true);
  const expCsvSlice = extractSlice(histFront, 'function exportarCsvHistorico()', '');
  assert.equal(expCsvSlice.includes('montarParamsFiltroHistorico()'), true);
});

test('Prorrogação de +2h hoje, nova tela de pausa e melhorias da auditoria visual/UX', () => {
  const dashHtml = fs.readFileSync(path.join(ROOT, 'public', 'dashboard.html'), 'utf8');

  // 1. Prorrogação de +2h após fechamento das 18h em 26/11/2026 mantendo regra base 06h-18h
  assert.equal(serverSrc.includes("const EXPEDIENTE_EXTRA_PADRAO_ATE_ISO = '2026-11-26T23:00:00.000Z';"), true);
  assert.equal(serverSrc.includes('if (hour < 6 || hour >= 18) return false;'), true);
  assert.equal(appSrc.includes("Date.parse('2026-11-26T20:00:00-03:00')"), true);

  // 2. Tela de pausa modernizada + modal de escolha de motivo
  assert.equal(indexHtml.includes('id="pause-clock"'), true);
  assert.equal(indexHtml.includes('id="pause-meta-time"'), true);
  assert.equal(indexHtml.includes('id="modal-config-pausa"'), true);
  assert.equal(indexHtml.includes('confirmarPausaPalestraModal()'), true);
  assert.equal(appSrc.includes('function atualizarRelogioPausa()'), true);
  assert.equal(appSrc.includes('function confirmarPausaPalestraModal()'), true);
  assert.equal(appSrc.includes('aplicarEstadoPausa(Boolean(d.pausado), d.motivo, d.pausado_em)'), true);

  // 3. Auditoria Visual/UX: zero CSS 404, acessibilidade, dark scheme, tabular-nums, reduced-motion, overscroll e Escape
  assert.equal(indexHtml.includes('styles.css?v=2.3'), false);
  assert.equal(indexHtml.includes('prefers-reduced-motion: reduce'), true);
  assert.equal(indexHtml.includes('overscroll-behavior: contain'), true);
  assert.equal(indexHtml.includes('role="dialog" aria-modal="true"'), true);
  assert.equal(indexHtml.includes('rel="noopener noreferrer"'), true);
  assert.equal(indexHtml.includes('<main class="main"'), true);
  assert.equal(indexHtml.includes('aria-label='), true);
  assert.equal(indexHtml.includes('class="fila-danger-group"') || appSrc.includes('class="fila-danger-group"'), true);
  assert.equal(appSrc.includes('aria-label="Ver QR Code de'), true);

  assert.equal(dashHtml.includes('color-scheme:dark'), true);
  assert.equal(dashHtml.includes(':focus-visible'), true);
  assert.equal(dashHtml.includes('tabular-nums'), true);
  assert.equal(dashHtml.includes('prefers-reduced-motion:reduce'), true);
  assert.equal(dashHtml.includes('<main class="main" id="dashContent"'), true);
  assert.equal(dashHtml.includes('transition:all'), false);
});

test('Layout Recepção (botão Prévia em destaque, Setor/Destino maior + cores, e Modal Prévia profissional)', () => {
  // 1. #recepcao-previa-receita-bar na Coluna 1 (abaixo de #prioridade-detalhes e antes da Coluna 2)
  const col1Slice = extractSlice(indexHtml, 'id="prioridade-detalhes"', '<!-- COLUNA 2: DESTINO / ENCAMINHAMENTO INICIAL -->');
  assert.equal(col1Slice.includes('id="recepcao-previa-receita-bar"'), true);
  assert.equal(col1Slice.includes('id="btn-abrir-previa-recepcao"'), true);
  const col2Slice = extractSlice(indexHtml, '<!-- COLUNA 2: DESTINO / ENCAMINHAMENTO INICIAL -->', '<!-- COLUNA 3:');
  assert.equal(col2Slice.includes('id="recepcao-previa-receita-bar"'), false);
  assert.equal(indexHtml.includes('min-height: 52px;'), true);

  // 2. Botões Setor / Fila de Destino com letra maior e cores distintas entre Médico e Dentista/Odontologia
  assert.equal(indexHtml.includes('font-size: 15px;'), true);
  assert.equal(indexHtml.includes('.setor-quick-btn[data-setor="Médico"]'), true);
  assert.equal(indexHtml.includes('.setor-quick-btn[data-setor="Odontologia"]'), true);
  assert.equal(col2Slice.includes('<span class="sq-label">Dentista</span>'), true);
  assert.equal(col2Slice.includes('<span class="sq-sub">Odontologia</span>'), true);

  // 3. Modal Prévia (#modal-captura-receita) estruturado em estação de trabalho 2 colunas, seções, labels for, rodapé e botão fechar refinado
  const modalCapturaSlice = extractSlice(indexHtml, 'id="modal-captura-receita"', '<!-- Modal 2: Consultório');
  assert.equal(modalCapturaSlice.includes('class="pr-workstation-grid"'), true);
  assert.equal(modalCapturaSlice.includes('class="pr-left-pane"'), true);
  assert.equal(modalCapturaSlice.includes('class="pr-right-pane"'), true);
  assert.equal(modalCapturaSlice.includes('class="pr-capture-zone"'), true);
  assert.equal(modalCapturaSlice.includes('class="pr-form-section"'), true);
  assert.equal(modalCapturaSlice.includes('class="pr-modal-footer"'), true);
  assert.equal(modalCapturaSlice.includes('class="pr-footer-actions"'), true);
  assert.equal(indexHtml.includes('background: rgba(255, 255, 255, 0.12);'), true);
  assert.equal(modalCapturaSlice.includes('for="pr-tipo"'), true);
  assert.equal(modalCapturaSlice.includes('for="pr-paciente-nome"'), true);
  assert.equal(modalCapturaSlice.includes('for="pr-medicamentos"'), true);
  for (const reqId of ['pr-btn-camera', 'pr-btn-confirmar', 'pr-btn-confirmar-sugerido', 'pr-btn-nova-analise']) {
    assert.equal(modalCapturaSlice.includes(`id="${reqId}"`), true, `ID obrigatório ausente no modal de prévia: ${reqId}`);
  }
});
