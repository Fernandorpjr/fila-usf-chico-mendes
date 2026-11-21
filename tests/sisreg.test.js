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
  normalizarResultadoOcrSisreg
} = require('../lib/sisreg');

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
