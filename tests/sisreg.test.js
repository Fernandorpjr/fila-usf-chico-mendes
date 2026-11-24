const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  repararMojibake,
  parsearHtmlCatalogoSisreg,
  validarCNS,
  validarTelefoneBR,
  verificarEnderecoRecife,
  calcularIdadeDataBR,
  buscarProcedimentosSisreg,
  formatarObservacaoSisreg,
  normalizarResultadoOcrSisreg,
  inferirSetorDestinoDevolucao,
  normalizarSetorDestinoDevolucao,
  resolverCanalChatDevolucao,
  normalizarStatusDevolucao,
  pertenceAoProfissionalDevolucao,
  formatarMensagemChatDevolucao,
  PRAZO_DEVOLUCAO_DIAS,
  MAX_PRORROGACOES_DEVOLUCAO,
  normalizarDetalhesDevolucao,
  validarAnexoDevolucao,
  calcularStatusPrazoDevolucao,
  limparAnexosDevolucoesExpirados
} = require('../lib/sisreg');
const {
  DEFAULT_GEMINI_MODELS,
  DEFAULT_GROQ_VISION_MODELS,
  buildGenerationConfig,
  ordenarModelosPorSaude,
  marcarModeloEmCooldown,
  resetarEstadoOcrTeste,
  formatarErroOcrAmigavel,
  executarOcrGeminiJson
} = require('../lib/ocr-ai');

test('repararMojibake cleans Latin-1/UTF-8 artifacts and HTML typos', () => {
  assert.equal(repararMojibake('CONSULTA EM PEDIATRIA- SÃ FILIS CONGENITA'), 'CONSULTA EM PEDIATRIA- SÍFILIS CONGENITA');
  assert.equal(repararMojibake('RADIOGRAFIA DE FÃŠMUR E MÃƒO ESQUERDA'), 'RADIOGRAFIA DE FÊMUR E MÃO ESQUERDA');
  assert.equal(repararMojibake('RADIORADIOGRAFIA DE COTOVELO'), 'RADIOGRAFIA DE COTOVELO');
  assert.equal(repararMojibake('PE DIREITO AP OBLÃ QUO'), 'PE DIREITO AP OBLÍQUO');
});

test('data/sisreg-catalogo-padrao.json exists, is clean DS5/Chico Mendes, and has full catalog', () => {
  const catPath = path.join(__dirname, '..', 'data', 'sisreg-catalogo-padrao.json');
  assert.ok(fs.existsSync(catPath), 'catalogo padrao json should exist');
  const cat = JSON.parse(fs.readFileSync(catPath, 'utf8'));
  assert.ok(cat.total >= 500, `expected >= 500 procedures, got ${cat.total}`);
  assert.equal(cat.unidade, 'US 177 USF CHICO MENDES');
  assert.equal(cat.cnes, '0000965');
  assert.equal(cat.distrito, 'DS5');
  assert.equal(cat.contato_nao_encontrado, 'Coordenador do DS5');
  assert.ok(!cat.unidade.includes('Apipucos'));
  assert.ok(!cat.distrito.includes('Distrito Sanitário V'));
  assert.ok(!cat.distrito.includes('DS3') && !cat.distrito.includes('DS III'));
});

test('parsearHtmlCatalogoSisreg handles UTF-16LE buffers and extracts DOM + sampleProcedures', () => {
  const sampleHtml = `<!DOCTYPE html><html><body>
    <div>Atualizado: 25/11/25</div>
    <div class="procedure-hierarchy">
      <div style="margin-left:20px;">
        <div class="level-2">40. CONSULTAS EM CIRURGIA GINECOLOGICA</div>
        <div class="procedure-list">
          <div class="procedure-item">CONSULTA EM CIRURGIA GINECOLOGICA - HISTEROSCOPIA CIRURGICA <span class="procedure-code">(0301010072)</span></div>
        </div>
      </div>
      <div style="margin-left:20px;">
        <div class="level-2">75. MAMOGRAFIA BILATERAL PARA RASTREAMENTO (0204030188)</div>
        <div class="procedure-list"></div>
      </div>
    </div>
    <script>
      const sampleProcedures = [
        { code: "0205020127-1", name: "ULTRA-SONOGRAFIA DOPPLER DE TIREOIDE", type: "Exame", status: "ATIVO", hierarchy: "1. Procedimento Ambulatorial > 1.15 GRUPO - EXAMES ULTRA-SONOGRAFICOS" }
      ];
    </script>
  </body></html>`;

  // BOM UTF-16LE simulation
  const bom = Buffer.from([0xff, 0xfe]);
  const utf16Buf = Buffer.concat([bom, Buffer.from(sampleHtml, 'utf16le')]);
  const parsed = parsearHtmlCatalogoSisreg(utf16Buf);

  assert.equal(parsed.total, 3);
  assert.equal(parsed.versao, '25/11/2025');
  const usg = parsed.procedimentos.find(p => p.code === '0205020127');
  assert.ok(usg);
  assert.equal(usg.type, 'Exame');
  assert.ok(parsed.procedimentos.some(p => p.code === '0204030188'));
  assert.ok(parsed.procedimentos.some(p => p.name.includes('HISTEROSCOPIA CIRURGICA')));
});

test('validarCNS validates official SUS check digits for series 1/2 and 7/8/9', () => {
  // Known valid CNS 700006774800208 (weighted sum mod 11 == 0)
  const valid7 = validarCNS('700 0067 7480 0208');
  assert.equal(valid7.valido, true);
  assert.equal(valid7.limpo, '700006774800208');

  // Known bad check digit (last digit altered)
  const invalid7 = validarCNS('700006774800209');
  assert.equal(invalid7.valido, false);

  // Wrong length
  assert.equal(validarCNS('12345').valido, false);
  // Empty
  assert.equal(validarCNS('').valido, null);

  // Compute a valid series-1 CNS deterministically and test it
  const pis = '10000000019';
  let soma = 0;
  for (let i = 0; i < 11; i++) soma += parseInt(pis[i], 10) * (15 - i);
  const resto = soma % 11;
  let dv = 11 - resto;
  if (dv === 11) dv = 0;
  const cns1 = dv === 10 ? `${pis}001${11 - ((soma + 2) % 11)}` : `${pis}000${dv}`;
  assert.equal(validarCNS(cns1).valido, true);
});

test('validarTelefoneBR normalizes, flags missing DDD 81, landline vs mobile, and incomplete', () => {
  const mob = validarTelefoneBR('(81) 99988-8002');
  assert.equal(mob.valido, true);
  assert.equal(mob.celular, true);
  assert.equal(mob.alerta, null);

  const noDdd = validarTelefoneBR('999888002');
  assert.equal(noDdd.valido, true);
  assert.equal(noDdd.somenteDigitos, '81999888002');
  assert.match(noDdd.alerta, /DDD 81/);

  const fixo = validarTelefoneBR('8133551234');
  assert.equal(fixo.valido, true);
  assert.equal(fixo.celular, false);

  const empty = validarTelefoneBR('');
  assert.equal(empty.valido, false);
});

test('verificarEnderecoRecife flags out-of-Recife municipalities, CEPs, and UFs', () => {
  assert.equal(
    verificarEnderecoRecife({ municipio: 'RECIFE', uf: 'PE', cep: '50761-000', endereco: 'Rua Chico Mendes, 100' }).status,
    'ok'
  );
  const olinda = verificarEnderecoRecife({ municipio: 'OLINDA', uf: 'PE', cep: '53130-000' });
  assert.equal(olinda.status, 'fora_recife');
  assert.match(olinda.alerta, /Olinda|OLINDA/);

  const jaboataoCep = verificarEnderecoRecife({ municipio: '', uf: 'PE', cep: '54400-000' });
  assert.equal(jaboataoCep.status, 'fora_recife');
  assert.match(jaboataoCep.alerta, /Jaboat/);

  const anotherState = verificarEnderecoRecife({ municipio: 'Recife', uf: 'PB', cep: '50761000' });
  assert.equal(anotherState.status, 'fora_recife');
});

test('buscarProcedimentosSisreg matches medical abbreviations, ignores hyphenation differences, and ranks by age/tipoVaga', () => {
  const catPath = path.join(__dirname, '..', 'data', 'sisreg-catalogo-padrao.json');
  const cat = JSON.parse(fs.readFileSync(catPath, 'utf8'));
  const procs = cat.procedimentos;

  const usg = buscarProcedimentosSisreg(procs, 'USG tireoide', { limite: 10 });
  assert.ok(usg.length >= 1, 'should find USG de tireoide via abbreviation USG');
  assert.ok(usg.some(p => p.code === '0205020127'));

  const eda = buscarProcedimentosSisreg(procs, 'EDA', { limite: 5 });
  assert.ok(eda.some(p => /ENDOSCOPIA DIGESTIVA ALTA/.test(p.name)));

  const eco = buscarProcedimentosSisreg(procs, 'ECO', { idade: 70, limite: 5 });
  assert.ok(eco[0].name.includes('> 60') || eco[0].name.includes('ECOCARDIOGRAFIA'));

  const cardioAdulto = buscarProcedimentosSisreg(procs, 'cardio', { idade: 40, tipoVaga: 'primeira_vez', limite: 5 });
  assert.ok(cardioAdulto.some(p => p.name.includes('CARDIOLOGIA')));
  assert.ok(!cardioAdulto[0].name.includes('RETORNO'), '1ª vez should outrank RETORNO');
  assert.ok(!cardioAdulto[0].name.includes('PEDIATRIA'), 'age 40 should outrank PEDIATRIA');

  const cardioRetorno = buscarProcedimentosSisreg(procs, 'cardio', { idade: 40, tipoVaga: 'retorno', limite: 5 });
  assert.ok(cardioRetorno[0].name.includes('RETORNO'), 'retorno flag should rank RETORNO first');

  // Garantir que atalhos e siglas criticas nunca trazem falso-positivos
  const mapaRes = buscarProcedimentosSisreg(procs, 'MAPA', { limite: 20 });
  assert.equal(mapaRes.length, 1, 'MAPA deve retornar apenas o exame MAPA');
  assert.equal(mapaRes[0].code, '0211020052');

  const tcRes = buscarProcedimentosSisreg(procs, 'TC', { limite: 10 });
  assert.equal(tcRes.length, 0, 'TC nao deve puxar Tempo de Coagulacao de laboratorio');

  const tomoRes = buscarProcedimentosSisreg(procs, 'TOMOGRAFIA', { limite: 10 });
  assert.equal(tomoRes.length, 0);

  const coagRes = buscarProcedimentosSisreg(procs, 'coagulograma', { limite: 10 });
  assert.ok(coagRes.some(p => p.code === '0202020070'));

  const ecoExact = buscarProcedimentosSisreg(procs, 'ECO', { limite: 20 });
  assert.ok(ecoExact.length >= 3 && ecoExact.every(p => /ECOCARDIOGRAFIA/i.test(p.name)));

  const edaExact = buscarProcedimentosSisreg(procs, 'EDA', { limite: 20 });
  assert.ok(edaExact.length >= 1 && edaExact.every(p => /ENDOSCOPIA DIGESTIVA ALTA|ESOFAGOGASTRODUODENOSCOPIA/i.test(p.name)));

  const beraExact = buscarProcedimentosSisreg(procs, 'BERA', { limite: 20 });
  assert.ok(beraExact.length >= 2 && beraExact.every(p => !/INFANTO-PUBERAL/i.test(p.name)));

  const espiroExact = buscarProcedimentosSisreg(procs, 'ESPIRO', { limite: 20 });
  assert.equal(espiroExact.length, 1);
  assert.equal(espiroExact[0].code, '0211080055');

  const uroExact = buscarProcedimentosSisreg(procs, 'URO', { limite: 50 });
  assert.ok(uroExact.length >= 1 && uroExact.every(p => !/NEUROLOGIA/i.test(p.name)));

  const atalhosValidos = ['USG', 'ECO', 'RADIOGRAFIA', 'MAMOGRAFIA', 'OFTALMO', 'CARDIO', 'ORTO', 'GINECO', 'DERMATO', 'EDA', 'COLONO', 'HOLTER', 'MAPA', 'ECG', 'ESPIRO', 'BERA'];
  atalhosValidos.forEach(t => {
    const r = buscarProcedimentosSisreg(procs, t, { limite: 5 });
    assert.ok(r.length >= 1, `atalho ${t} deve retornar ao menos 1 resultado`);
  });
});

test('formatarObservacaoSisreg and normalizarResultadoOcrSisreg sanitize properly', () => {
  assert.equal(formatarObservacaoSisreg('  Nódulo   submucoso em região  ', true), 'NODULO SUBMUCOSO EM REGIAO');
  const idade = calcularIdadeDataBR('01/01/1980', new Date('2026-11-21T12:00:00Z'));
  assert.equal(idade, 46);

  const norm = normalizarResultadoOcrSisreg({
    especialidade_ou_exame: 'Cardiologia',
    procedimentos_pedidos: ['ECG'],
    observacoes_original: 'Paciente com dor torácica',
    observacoes_revisada: null
  });
  assert.deepEqual(norm.procedimentos_pedidos, ['Cardiologia', 'ECG']);
  assert.equal(norm.observacoes_revisada, 'Paciente com dor torácica');
});

test('buscarProcedimentosSisreg filters Exames de Laboratorio, Idade e Retorno/1a Vez strictly (including empty query)', () => {
  const procs = require('../data/sisreg-catalogo-padrao.json').procedimentos;

  // Atalho Exames de Laboratorio deve trazer todos os exames laboratoriais (260+)
  const labAtalho = buscarProcedimentosSisreg(procs, 'EXAMES DE LABORATORIO', { limite: 300 });
  assert.ok(labAtalho.length >= 250, `EXAMES DE LABORATORIO deve retornar >= 250 itens, retornou ${labAtalho.length}`);
  assert.ok(labAtalho.every(p => /PATOLOGIA CLINICA|EXAMES DE LABORATORIO/i.test(p.hierarchy)));

  const labSinon = buscarProcedimentosSisreg(procs, 'laboratorio', { limite: 300 });
  assert.ok(labSinon.length >= 250, 'sinonimo laboratorio deve encontrar exames laboratoriais');

  // Filtro de idade na busca vazia e com termo deve excluir faixas incompatíveis
  const pedVazio = buscarProcedimentosSisreg(procs, '', { idade: 8, limite: 40 });
  assert.ok(pedVazio.length > 0);
  assert.ok(pedVazio.every(p => !/>\s*1[4-8]\b|>\s*60\b|\bGERIATRIA\b|\bADULTO\b(?! OU INFANTIL)/i.test(p.name)));
  assert.ok(/PEDIATR|INFANT|0 A 1|2 A 1|5 A 13|ANOS/i.test(pedVazio[0].name), 'pediatrico deve priorizar itens pediatricos no topo');

  const pedOftalmo = buscarProcedimentosSisreg(procs, 'oftalmo', { idade: 8, limite: 20 });
  assert.ok(pedOftalmo.length >= 1);
  assert.ok(pedOftalmo.every(p => !/>\s*14\b/i.test(p.name)), 'oftalmo pediatrico nao deve retornar >14 anos');

  const adultCardio = buscarProcedimentosSisreg(procs, 'cardio', { idade: 35, limite: 20 });
  assert.ok(adultCardio.length >= 1);
  assert.ok(adultCardio.every(p => !/PEDIATR|>\s*60\b|GERIATR/i.test(p.name)), 'cardio adulto nao deve retornar pediatria nem >60');

  const idosoCardio = buscarProcedimentosSisreg(procs, 'cardio', { idade: 65, limite: 20 });
  assert.ok(idosoCardio.length >= 1);
  assert.ok(idosoCardio.every(p => !/PEDIATR/i.test(p.name)), 'cardio idoso nao deve retornar pediatria');
  assert.ok(/>\s*60\b/.test(idosoCardio[0].name), 'cardio idoso deve priorizar >60 anos');

  // Filtro 1a Vez vs Retorno (busca vazia e busca com termo)
  const soRetornoVazio = buscarProcedimentosSisreg(procs, '', { tipoVaga: 'retorno', limite: 100 });
  assert.ok(soRetornoVazio.length > 0 && soRetornoVazio.every(p => /\bRETORNO\b/i.test(p.name)));

  const soPrimeiraCardio = buscarProcedimentosSisreg(procs, 'cardio', { tipoVaga: 'primeira_vez', limite: 30 });
  assert.ok(soPrimeiraCardio.length > 0 && soPrimeiraCardio.every(p => !/\bRETORNO\b/i.test(p.name)));

  const soRetornoCardio = buscarProcedimentosSisreg(procs, 'cardio', { idade: 40, tipoVaga: 'retorno', limite: 10 });
  assert.ok(soRetornoCardio.length > 0 && soRetornoCardio.every(p => /\bRETORNO\b/i.test(p.name) && !/PEDIATR|>\s*60\b/i.test(p.name)));
});

test('Devoluções SISREG direcionam corretamente ACS/Médico/Enfermagem/Odonto, canais e mensagens de alerta/solução', () => {
  assert.equal(inferirSetorDestinoDevolucao('Endereço de outra cidade (fora de Recife) / Cadastro', 'Dra. Mirela Mota'), 'ACS');
  assert.equal(inferirSetorDestinoDevolucao('Telefone / CNS desatualizado', 'Dr. Israel Christian'), 'ACS');
  assert.equal(inferirSetorDestinoDevolucao('Procedimento incorreto / faixa etária', 'Dra. Mirela Mota'), 'Médico');
  assert.equal(inferirSetorDestinoDevolucao('Falta justificativa clínica', 'Mariana Vaz'), 'Enfermagem');
  assert.equal(inferirSetorDestinoDevolucao('Procedimento incorreto', 'Dra. Juliana Cavalcante'), 'Odontologia');
  assert.equal(inferirSetorDestinoDevolucao('Outro', 'Ana Paula (ACS)'), 'ACS');

  assert.equal(resolverCanalChatDevolucao('ACS'), 'acs');
  assert.equal(resolverCanalChatDevolucao('Enfermagem'), 'enfermagem');
  assert.equal(resolverCanalChatDevolucao('Odontologia'), 'odontologia');
  assert.equal(resolverCanalChatDevolucao('Médico'), 'medico');

  assert.equal(normalizarStatusDevolucao('respondida'), 'respondida');
  assert.equal(normalizarStatusDevolucao('corrigida'), 'corrigida');
  assert.equal(normalizarStatusDevolucao('desconhecido'), 'pendente');

  const msgAlerta = formatarMensagemChatDevolucao({
    paciente_nome: 'Maria José',
    codigo_solicitacao: '12345',
    procedimento: 'USG ABDOMEN',
    motivo: 'Endereço / Cadastro desatualizado (ACS)',
    setor_destino: 'ACS',
    profissional_equipe: 'Ana Paula',
    observacao: 'Confirmar rua atual'
  }, 'alerta');
  assert.ok(msgAlerta.includes('DEVOLUÇÃO SISREG [Setor: ACS · Ana Paula]'));
  assert.ok(msgAlerta.includes('Destinatário: Ana Paula'));
  assert.ok(msgAlerta.includes('Devoluções SISREG'));

  const msgTodosMed = formatarMensagemChatDevolucao({
    paciente_nome: 'José Carlos',
    motivo: 'Falta justificativa clínica',
    setor_destino: 'Médico',
    profissional_equipe: 'Todos os Médicos'
  }, 'alerta');
  assert.ok(msgTodosMed.includes('Destinatário: Todos (Médico)'));

  // Filtro estrito por destinatário (Médico, Enfermagem, Odontologia, ACS vs Todos)
  const devIsrael = { setor_destino: 'Médico', profissional_equipe: 'Dr. Israel Christian', motivo: 'CID' };
  const devTodosMed = { setor_destino: 'Médico', profissional_equipe: null, motivo: 'CID' };
  const devMariana = { setor_destino: 'Enfermagem', profissional_equipe: 'Mariana Vaz', motivo: 'Justificativa' };
  const devJuliana = { setor_destino: 'Odontologia', profissional_equipe: 'Dra. Juliana Cavalcante', motivo: 'Proc' };
  const devAnaPaula = { setor_destino: 'ACS', profissional_equipe: 'Ana Paula', motivo: 'Endereço' };

  assert.equal(pertenceAoProfissionalDevolucao(devIsrael, 'Médico', 'Dr. Israel Christian'), true);
  assert.equal(pertenceAoProfissionalDevolucao(devIsrael, 'Médico', 'Dr. Joene Halan'), false);
  assert.equal(pertenceAoProfissionalDevolucao(devIsrael, 'Médico', ''), true);
  assert.equal(pertenceAoProfissionalDevolucao(devTodosMed, 'Médico', 'Dr. Joene Halan'), true);
  assert.equal(pertenceAoProfissionalDevolucao(devMariana, 'Enfermagem', 'Mariana Vaz'), true);
  assert.equal(pertenceAoProfissionalDevolucao(devMariana, 'Enfermagem', 'Jorge Marcio'), false);
  assert.equal(pertenceAoProfissionalDevolucao(devJuliana, 'Odontologia', 'Dra. Juliana Cavalcante'), true);
  assert.equal(pertenceAoProfissionalDevolucao(devJuliana, 'Médico', 'Dr. Israel Christian'), false);
  assert.equal(pertenceAoProfissionalDevolucao(devAnaPaula, 'ACS', 'Ana Paula'), true);
  assert.equal(pertenceAoProfissionalDevolucao(devAnaPaula, 'ACS', 'Lenilda'), false);

  // Estabilidade OCR (motor centralizado lib/ocr-ai.js + ObjectURL + AbortController + câmera multi-foto + retry)
  const root = path.join(__dirname, '..');
  const ocrAiBack = fs.readFileSync(path.join(root, 'lib', 'ocr-ai.js'), 'utf8');
  const receitasBack = fs.readFileSync(path.join(root, 'lib', 'receitas.js'), 'utf8');
  const sisregBack = fs.readFileSync(path.join(root, 'lib', 'sisreg.js'), 'utf8');
  const receitasFront = fs.readFileSync(path.join(root, 'public', 'receitas-previa.js'), 'utf8');
  const sisregFront = fs.readFileSync(path.join(root, 'public', 'regulacao-sisreg.js'), 'utf8');

  assert.ok(ocrAiBack.includes('gemini-3.5-flash-lite') && ocrAiBack.includes('thinkingBudget: 0') && ocrAiBack.includes("thinkingLevel: 'MINIMAL'"));
  assert.ok(receitasBack.includes('executarOcrGeminiJson') && sisregBack.includes('executarOcrGeminiJson'));
  assert.ok(receitasFront.includes('URL.createObjectURL') && receitasFront.includes('AbortController') && receitasFront.includes('reanalisarAnexosPendentesReceita'));
  assert.ok(sisregFront.includes('URL.createObjectURL') && sisregFront.includes('AbortController') && sisregFront.includes('reanalisarAnexoAtivoModalMed'));
  assert.ok(sisregFront.includes('navegarFotoModalMed') && sisregFront.includes('dev-prof-filtro-prof'));

  const msgSol = formatarMensagemChatDevolucao({
    paciente_nome: 'Maria José',
    codigo_solicitacao: '12345',
    setor_destino: 'ACS',
    solucao: 'Mudou para Rua da Aurora, 100',
    solucao_autor: 'Ana Paula'
  }, 'solucao');
  assert.ok(msgSol.includes('SOLUÇÃO DEVOLUÇÃO SISREG'));
  assert.ok(msgSol.includes('Ana Paula (ACS)'));
  assert.ok(msgSol.includes('Mudou para Rua da Aurora, 100'));
});

test('Motor OCR resiliente (lib/ocr-ai.js) faz fallback de 503, circuit breaker, tradução PT-BR e cache SHA-256', async () => {
  resetarEstadoOcrTeste();
  assert.equal(DEFAULT_GEMINI_MODELS[0], 'gemini-3.5-flash-lite');
  assert.ok(DEFAULT_GEMINI_MODELS.includes('gemini-flash-lite-latest'));
  assert.ok(DEFAULT_GEMINI_MODELS.includes('gemini-3.6-flash'));
  assert.ok(!DEFAULT_GEMINI_MODELS.includes('gemini-2.5-flash-lite'));
  assert.ok(DEFAULT_GROQ_VISION_MODELS.includes('qwen/qwen3.8-27b'));

  assert.deepEqual(buildGenerationConfig('gemini-3.5-flash-lite', 1800).thinkingConfig, { thinkingLevel: 'MINIMAL' });
  assert.deepEqual(buildGenerationConfig('gemini-2.5-flash-lite', 1800).thinkingConfig, { thinkingBudget: 0 });
  assert.equal(buildGenerationConfig('gemini-3.5-flash-lite', 1800, false).thinkingConfig, undefined);

  // Circuit breaker move modelo congestionado para o fim da fila
  marcarModeloEmCooldown('gemini-3.5-flash-lite', 503, 1000);
  const ordenados = ordenarModelosPorSaude(['gemini-3.5-flash-lite', 'gemini-flash-lite-latest'], 5000);
  assert.deepEqual(ordenados, ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite']);

  // Fallback real com mock fetchImpl (1o retorna 503 -> cai automatico para o 2o que retorna 200 -> 2a chamada vem do cache)
  resetarEstadoOcrTeste();
  const chamados = [];
  const fakeFetch = async (url) => {
    chamados.push(url);
    if (url.includes('gemini-3.5-flash-lite')) {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: { message: 'This model is currently experiencing high demand.' } })
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ paciente_nome: 'MARIA SILVA', confianca: 92 }) }] } }]
      })
    };
  };

  const res1 = await executarOcrGeminiJson({
    apiKey: 'fake-key',
    groqApiKey: '',
    prompt: 'extract',
    mimeType: 'image/jpeg',
    base64Data: 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=',
    cacheNamespace: 'teste',
    fetchImpl: fakeFetch,
    backoffBaseMs: 0,
    jitterMaxMs: 0
  });
  assert.equal(res1.ok, true);
  assert.equal(res1.provider, 'gemini');
  assert.equal(res1.model, 'gemini-flash-lite-latest');
  assert.equal(res1.parsed.paciente_nome, 'MARIA SILVA');
  assert.equal(res1.fromCache, false);
  assert.equal(chamados.length, 2);

  // Mesma imagem retorna imediatamente do cache sem chamar fetchImpl
  const resCache = await executarOcrGeminiJson({
    apiKey: 'fake-key',
    groqApiKey: '',
    prompt: 'extract',
    mimeType: 'image/jpeg',
    base64Data: 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=',
    cacheNamespace: 'teste',
    fetchImpl: fakeFetch
  });
  assert.equal(resCache.ok, true);
  assert.equal(resCache.provider, 'gemini');
  assert.equal(resCache.fromCache, true);
  assert.equal(chamados.length, 2);

  // Traducao amigavel quando todos falham com 503
  assert.ok(formatarErroOcrAmigavel('This model is currently experiencing high demand', 503).includes('congestionado'));
  assert.ok(formatarErroOcrAmigavel('Quota exceeded', 429).includes('gratuita'));
});

test('Motor OCR faz failover automático para Groq Vision em imagens, respeita cache e ignora Groq em PDFs', async () => {
  // Caso 1: Todos Gemini retornam 503 -> cai automatico para Groq Vision -> 2a chamada vem do cache
  resetarEstadoOcrTeste();
  const calls1 = [];
  const fakeFetchFailover = async (url, init) => {
    calls1.push({ url, init });
    if (url.includes('generativelanguage.googleapis.com')) {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: { message: 'This model is currently experiencing high demand.' } })
      };
    }
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(init.headers.Authorization, 'Bearer fake-groq');
    const body = JSON.parse(init.body);
    const sysMsg = body.messages.find(m => m.role === 'system');
    const userMsg = body.messages.find(m => m.role === 'user');
    assert.ok(sysMsg && sysMsg.content.includes('observacoes_revisada'));
    assert.equal(userMsg.content[1].type, 'image_url');
    assert.ok(userMsg.content[1].image_url.url.startsWith('data:image/jpeg;base64,'));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ paciente_nome: 'JOSE GROQ', confianca: 88 }) } }]
      })
    };
  };

  const groqRes1 = await executarOcrGeminiJson({
    apiKey: 'fake-gemini',
    groqApiKey: 'fake-groq',
    prompt: 'extract',
    mimeType: 'image/jpeg',
    base64Data: 'R1JPUV9JTUFHRV9URVNUXzE=',
    cacheNamespace: 'groq-teste',
    fetchImpl: fakeFetchFailover,
    backoffBaseMs: 0,
    jitterMaxMs: 0
  });
  assert.equal(groqRes1.ok, true);
  assert.equal(groqRes1.provider, 'groq');
  assert.equal(groqRes1.model, 'groq/qwen/qwen3.8-27b');
  assert.equal(groqRes1.parsed.paciente_nome, 'JOSE GROQ');
  assert.equal(groqRes1.fromCache, false);
  const callsAfterFirst = calls1.length;
  assert.ok(calls1.some(c => c.url.includes('api.groq.com')));

  const groqCached = await executarOcrGeminiJson({
    apiKey: 'fake-gemini',
    groqApiKey: 'fake-groq',
    prompt: 'extract',
    mimeType: 'image/jpeg',
    base64Data: 'R1JPUV9JTUFHRV9URVNUXzE=',
    cacheNamespace: 'groq-teste',
    fetchImpl: fakeFetchFailover
  });
  assert.equal(groqCached.ok, true);
  assert.equal(groqCached.provider, 'groq');
  assert.equal(groqCached.fromCache, true);
  assert.equal(calls1.length, callsAfterFirst);

  // Caso 2: PDF com Gemini em 503 nunca chama Groq Vision
  resetarEstadoOcrTeste();
  const callsPdf = [];
  const fakeFetchPdf = async (url) => {
    callsPdf.push(url);
    return {
      ok: false,
      status: 503,
      json: async () => ({ error: { message: 'This model is currently experiencing high demand.' } })
    };
  };
  const pdfRes = await executarOcrGeminiJson({
    apiKey: 'fake-gemini',
    groqApiKey: 'fake-groq',
    prompt: 'extract',
    mimeType: 'application/pdf',
    base64Data: 'JVBERi0xLjQK',
    cacheNamespace: 'groq-pdf',
    fetchImpl: fakeFetchPdf,
    backoffBaseMs: 0,
    jitterMaxMs: 0
  });
  assert.equal(pdfRes.ok, false);
  assert.equal(callsPdf.some(u => u.includes('api.groq.com')), false);

  // Caso 3: Sem chave Gemini, mas com groqApiKey em imagem -> chama direto Groq Vision
  resetarEstadoOcrTeste();
  const callsOnlyGroq = [];
  const onlyGroqRes = await executarOcrGeminiJson({
    apiKey: '',
    groqApiKey: 'fake-groq',
    prompt: 'extract',
    mimeType: 'image/jpeg',
    base64Data: 'T05MWV9HUk9RX0lNRw==',
    cacheNamespace: 'groq-only',
    fetchImpl: async (url) => {
      callsOnlyGroq.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ paciente_nome: 'APENAS GROQ' }) } }]
        })
      };
    }
  });
  assert.equal(onlyGroqRes.ok, true);
  assert.equal(onlyGroqRes.provider, 'groq');
  assert.equal(onlyGroqRes.parsed.paciente_nome, 'APENAS GROQ');
  assert.deepEqual(callsOnlyGroq, ['https://api.groq.com/openai/v1/chat/completions']);

  const receitaNoSisreg = normalizarResultadoOcrSisreg({
    tipo_arquivo: 'receita_branca',
    medicamentos: 'Losartana 50mg, Metformina 850mg',
    data_emissao_receita: '10/11/2026'
  });
  assert.equal(receitaNoSisreg.tipo_arquivo, 'receita_branca');
  assert.equal(receitaNoSisreg.medicamentos, 'Losartana 50mg, Metformina 850mg');
  assert.equal(receitaNoSisreg.data_emissao_receita, '10/11/2026');
});

test('Devoluções SISREG validam anexos, detalhes, prazo de 3 dias e limpeza automática de vencidos', async () => {
  assert.equal(PRAZO_DEVOLUCAO_DIAS, 3);
  assert.equal(MAX_PRORROGACOES_DEVOLUCAO, 3);

  assert.equal(normalizarDetalhesDevolucao({ cns: '', dn: 'null' }), null);
  const det = normalizarDetalhesDevolucao({ cns: '898001234567890', endereco: 'Rua Recife, 10', cid10: 'I10' });
  assert.deepEqual(det.cns, '898001234567890');
  assert.deepEqual(det.cid10, 'I10');

  assert.equal(validarAnexoDevolucao(null).anexo_base64, null);
  assert.equal(validarAnexoDevolucao('texto-invalido').ok, false);
  const imgB64 = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg-bytes').toString('base64');
  const okImg = validarAnexoDevolucao(imgB64, 'image', 'ficha.jpg');
  assert.equal(okImg.ok, true);
  assert.equal(okImg.anexo_tipo, 'image');
  assert.ok(okImg.anexo_bytes > 0);

  const gigante = 'data:application/pdf;base64,' + 'A'.repeat(2_200_000);
  assert.equal(validarAnexoDevolucao(gigante, 'pdf', 'grande.pdf').ok, false);

  const agora = new Date('2026-11-22T15:00:00Z');
  assert.equal(calcularStatusPrazoDevolucao(new Date('2026-11-25T15:00:00Z'), 'pendente', agora).diasRestantes, 3);
  assert.equal(calcularStatusPrazoDevolucao(new Date('2026-11-23T05:00:00Z'), 'pendente', agora).label, 'Vence em 14h');
  assert.equal(calcularStatusPrazoDevolucao(new Date('2026-11-21T10:00:00Z'), 'pendente', agora).vencido, true);
  assert.equal(calcularStatusPrazoDevolucao(new Date('2026-11-21T10:00:00Z'), 'corrigida', agora).label, 'Corrigida');

  let sqlExecutado = '';
  const removidos = await limparAnexosDevolucoesExpirados({
    query: async (sql) => {
      sqlExecutado = sql;
      return { rowCount: 4 };
    }
  });
  assert.equal(removidos, 4);
  assert.ok(sqlExecutado.includes('anexo_base64 = NULL'));
  assert.ok(sqlExecutado.includes("status = 'corrigida'"));
  assert.ok(sqlExecutado.includes('prazo_em < CURRENT_TIMESTAMP'));
});
