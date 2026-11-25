const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  GRUPOS_TUBOS_RECIFE,
  PERFIS_RAPIDOS_COLETA,
  extrairCodigosExamesDeTexto,
  normalizarPayloadExamesColeta,
  calcularResumoTubosColeta
} = require('../public/exames-tubos');

test('Catálogo de tubos calcula todos os 8 grupos do Laboratório Municipal do Recife', () => {
  const res = calcularResumoTubosColeta({
    exames: [
      'GLICOSE(GLC)',
      'HB.GLIC.(HBGL)',
      'COL.T.+FR (CTF)',
      'CREAT. (CN)',
      '(VDRL)',
      '(HIV)',
      'HEMOG.(HGCOM)',
      'ABORH(GSAFRH)',
      'VSH',
      'TPAE',
      'S. URINA(SM)',
      'FEZES 1(PF1)'
    ]
  });

  assert.equal(GRUPOS_TUBOS_RECIFE.length, 10);
  // 8 grupos de tubos de sangue: cinza, roxo_imuno, amarelo_imuno, amarelo_soro, roxo_hemato, roxo_abo, preto_vsh, azul_coag
  assert.equal(res.tubos.length, 8);
  assert.equal(res.totalTubos, 8);
  // Urina e Fezes são coletores, não somam nos tubos de sangue
  assert.equal(res.coletores.length, 2);

  const byId = Object.fromEntries(res.tubos.map(t => [t.grupoId, t]));
  assert.equal(byId.cinza.quantidade, 1);
  assert.equal(byId.roxo_imuno.quantidade, 1);
  assert.equal(byId.amarelo_imuno.quantidade, 1);
  assert.equal(byId.amarelo_soro.quantidade, 1);
  assert.equal(byId.roxo_hemato.quantidade, 1);
  assert.equal(byId.roxo_abo.quantidade, 1);
  assert.equal(byId.preto_vsh.quantidade, 1);
  assert.equal(byId.azul_coag.quantidade, 1);
});

test('Regra Julião: Glicose Jejum + Glicose Pós-Prandial soma 2 tubos Cinza', () => {
  const soJejum = calcularResumoTubosColeta({ exames: ['GLICOSE(GLC)'] });
  assert.equal(soJejum.tubos[0].grupoId, 'cinza');
  assert.equal(soJejum.tubos[0].quantidade, 1);

  const ambos = calcularResumoTubosColeta({ exames: ['GLICOSE(GLC)', 'GLICOSEPP(GPP)'] });
  assert.equal(ambos.tubos[0].grupoId, 'cinza');
  assert.equal(ambos.tubos[0].quantidade, 2);
  assert.equal(ambos.totalTubos, 2);
  assert.ok(ambos.tubos[0].detalhe.includes('Jejum') && ambos.tubos[0].detalhe.includes('Pós-prandial'));
});

test('Separa obrigatoriamente Amarelo Imunoquímica x Amarelo Sorologia e 1º Roxo x 2º Roxo x Roxo HbA1c', () => {
  const codigos = extrairCodigosExamesDeTexto('Hemograma, ABO/Rh, Hemoglobina Glicada, TSH, VDRL, HIV, Urocultura');
  assert.ok(codigos.includes('HEMOG.(HGCOM)'));
  assert.ok(codigos.includes('ABORH(GSAFRH)'));
  assert.ok(codigos.includes('HB.GLIC.(HBGL)'));
  assert.ok(codigos.includes('(TSH)'));
  assert.ok(codigos.includes('(VDRL)'));
  assert.ok(codigos.includes('(HIV)'));
  assert.ok(codigos.includes('UROCUL(CUC)'));

  const resumo = calcularResumoTubosColeta({ exames: codigos });
  // 1º Roxo (Hemato) + 2º Roxo (ABO/Rh) + Roxo Imuno (HbA1c) + Amarelo Imuno (TSH) + Amarelo Soro (VDRL/HIV) = 5 tubos
  assert.equal(resumo.totalTubos, 5);
  assert.equal(resumo.coletores.length, 1);
  assert.equal(resumo.coletores[0].grupoId, 'urina');
});

test('Suporta seleção manual de tubos na pressa e perfis rápidos da unidade', () => {
  const hiperdia = PERFIS_RAPIDOS_COLETA.find(p => p.id === 'hiperdia');
  assert.ok(hiperdia);
  const resPerfil = calcularResumoTubosColeta({ exames: hiperdia.exames });
  // Cinza (GLC) + Roxo Imuno (HBGL) + Amarelo Imuno (Colesterol/Creat/Ureia/Iono/Ac.Urico) = 3 tubos + 1 pote urina
  assert.equal(resPerfil.totalTubos, 3);
  assert.equal(resPerfil.coletores.length, 1);

  const manual = normalizarPayloadExamesColeta({
    tubos_manuais: { cinza: 2, amarelo_imuno: 1, roxo_hemato: 1 }
  });
  const resManual = calcularResumoTubosColeta(manual);
  assert.equal(resManual.totalTubos, 4);
});

test('LGPD & Regras Bloco 3: exames_coleta nunca vaza na TV/QR e log_prioridade não recebe edições manuais', () => {
  const root = path.join(__dirname, '..');
  const serverJs = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

  // sanitizarPacientePublico remove exames_coleta
  const idxSanit = serverJs.indexOf('function sanitizarPacientePublico');
  assert.ok(idxSanit > 0);
  const sanitSlice = serverJs.slice(idxSanit, idxSanit + 500);
  assert.equal(sanitSlice.includes('delete clone.exames_coleta'), true);

  // Rotas públicas não selecionam exames_coleta
  const idxStatus = serverJs.indexOf("app.get('/api/patients/:id/status'");
  const statusSlice = serverJs.slice(idxStatus, idxStatus + 600);
  assert.equal(statusSlice.includes('exames_coleta'), false);

  const idxCalling = serverJs.indexOf("app.get('/api/current-calling'");
  const callingSlice = serverJs.slice(idxCalling, idxCalling + 700);
  assert.equal(callingSlice.includes('exames_coleta'), false);

  // No frontend, tubos e badges verificam !modo-tv
  assert.equal(appJs.includes('function renderBadgesTubosColeta'), true);
  const idxTubosUi = appJs.indexOf('function renderBadgesTubosColeta');
  const tubosSlice = appJs.slice(idxTubosUi, idxTubosUi + 450);
  assert.equal(tubosSlice.includes("document.body.classList.contains('modo-tv')"), true);

  // Novas rotas e proteção contra remoção de prioridade sem gerente/admin
  assert.equal(serverJs.includes("app.put('/api/patients/:id/prioridade'"), true);
  assert.equal(serverJs.includes('requiresManagerPassword: true'), true);
  assert.equal(serverJs.includes("app.put('/api/patients/:id/exames-coleta'"), true);
  assert.equal(serverJs.includes("app.put('/api/patients/:id/ausente-temporario'"), true);
  assert.equal(serverJs.includes("app.post('/api/agendamentos/:id/enviar-fila'"), true);
  assert.equal(serverJs.includes('log_auditoria_fila'), true);
});
