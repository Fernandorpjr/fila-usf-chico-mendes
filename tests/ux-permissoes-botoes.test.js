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
