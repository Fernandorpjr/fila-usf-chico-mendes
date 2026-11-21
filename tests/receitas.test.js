const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_ANEXOS_PREVIA,
  calcularDataVencimento,
  calcularDiasRestantes,
  classificarUrgencia,
  classificarReceita,
  classificarDocumentoPrevia,
  normalizarCategoriaAnexo,
  normalizarAnexosPrevia,
  resumirAnexosSemImagem,
  normalizarDadosExtras,
  formatarPrescricaoParaFormulario
} = require('../lib/receitas');

test('calcularDataVencimento adds 2 or 6 months cleanly', () => {
  assert.equal(calcularDataVencimento('10/01/2026', 6), '10/07/2026');
  assert.equal(calcularDataVencimento('10/10/2026', 2), '10/12/2026');
  assert.equal(calcularDataVencimento('invalid', 6), null);
});

test('classificarUrgencia classifies expired, urgent <=7d, and normal', () => {
  assert.equal(classificarUrgencia(-1), 'vencida');
  assert.equal(classificarUrgencia(0), 'urgente');
  assert.equal(classificarUrgencia(7), 'urgente');
  assert.equal(classificarUrgencia(8), 'normal');
  assert.equal(classificarUrgencia(null), 'normal');
});

test('classificarReceita routes azul to Medico (2 months)', () => {
  const r = classificarReceita('azul', 'Clonazepam 2mg', '10/08/2026', new Date('2026-11-20T12:00:00Z'));
  assert.equal(r.fila_destino, 'Médico');
  assert.equal(r.validade_meses, 2);
  assert.equal(r.data_vencimento, '10/10/2026');
  assert.equal(r.urgencia, 'vencida');
});

test('classificarReceita routes Hiperdia branca allowed meds to Enfermagem (6 months)', () => {
  const r = classificarReceita('branca', 'Losartana 50mg, Metformina 850mg, Hidroclorotiazida 25mg', '20/10/2026', new Date('2026-11-20T12:00:00Z'));
  assert.equal(r.fila_destino, 'Enfermagem');
  assert.equal(r.validade_meses, 6);
  assert.equal(r.data_vencimento, '20/04/2027');
  assert.equal(r.urgencia, 'normal');
});

test('classificarReceita routes branca with Sinvastatina or unknown med to Medico', () => {
  const rSinv = classificarReceita('branca', 'Losartana 50mg, Sinvastatina 20mg', '20/10/2026', new Date('2026-11-20T12:00:00Z'));
  assert.equal(rSinv.fila_destino, 'Médico');

  const rUnk = classificarReceita('branca', 'Medicamento Xpto 10mg', '20/10/2026', new Date('2026-11-20T12:00:00Z'));
  assert.equal(rUnk.fila_destino, 'Médico');
  assert.equal(rUnk.medicamento_desconhecido, true);
});

test('calcularDiasRestantes computes day difference properly', () => {
  const dias = calcularDiasRestantes('25/11/2026', new Date('2026-11-20T13:00:00Z'));
  assert.equal(dias, 5);
});

test('normalizarDadosExtras sanitizes optional OCR fields and normalizes sex', () => {
  assert.equal(normalizarDadosExtras(null), null);
  assert.equal(normalizarDadosExtras({ paciente_endereco: 'null', paciente_sexo: 'não informado' }), null);
  const ext = normalizarDadosExtras({
    medicamentos_posologia: '1) Losartana 50mg - 1 cp 12/12h',
    paciente_endereco: 'Rua X, 123 - Varzea',
    paciente_data_nascimento: '01/05/1970',
    paciente_sexo: 'masculino',
    paciente_telefone: '(81) 99999-0000',
    paciente_mae: 'Maria da Silva',
    especialidade: 'Cardiologia',
    cid10: 'I10'
  });
  assert.deepEqual(ext, {
    medicamentos_posologia: '1) Losartana 50mg - 1 cp 12/12h',
    paciente_endereco: 'Rua X, 123 - Varzea',
    paciente_data_nascimento: '01/05/1970',
    paciente_sexo: 'M',
    paciente_telefone: '(81) 99999-0000',
    paciente_mae: 'Maria da Silva',
    especialidade: 'Cardiologia',
    hipotese_diagnostica: null,
    cid10: 'I10',
    justificativa: null
  });
});

test('formatarPrescricaoParaFormulario prefers posologia, falls back cleanly, and handles empty', () => {
  assert.equal(formatarPrescricaoParaFormulario(null), '');
  assert.equal(
    formatarPrescricaoParaFormulario({
      medicamentos: 'Losartana 50mg',
      dados_extras: { medicamentos_posologia: '1) Losartana 50mg - 1 cp pela manhã' }
    }),
    '1) Losartana 50mg - 1 cp pela manhã'
  );
  assert.equal(
    formatarPrescricaoParaFormulario({
      medicamentos: 'Losartana 50mg, Metformina 850mg',
      observacoes: 'Uso contínuo'
    }),
    '1) Losartana 50mg\n2) Metformina 850mg\nObs: Uso contínuo'
  );
});

test('normalizarAnexosPrevia enforces max 6 limit, legacy fallback, categories, and resumirAnexosSemImagem omits base64', () => {
  assert.equal(normalizarCategoriaAnexo('Receita Azul Controlada'), 'receita_azul');
  assert.equal(normalizarCategoriaAnexo('Encaminhamento Cardiologia'), 'encaminhamento');
  assert.equal(normalizarCategoriaAnexo('Exame laboratorial'), 'exame');

  const fakeImg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAA==';
  const legacy = normalizarAnexosPrevia(null, fakeImg, 'azul');
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].categoria, 'receita_azul');
  assert.equal(legacy[0].imagem_base64, fakeImg);

  const many = Array.from({ length: 9 }, (_, i) => ({
    id: `f_${i}`,
    categoria: i === 2 ? 'encaminhamento' : 'branca',
    rotulo: `Doc ${i + 1}`,
    imagem_base64: fakeImg
  }));
  const norm = normalizarAnexosPrevia(many);
  assert.equal(norm.length, MAX_ANEXOS_PREVIA);
  assert.equal(norm[2].categoria, 'encaminhamento');

  const resumo = resumirAnexosSemImagem(norm);
  assert.equal(resumo.length, MAX_ANEXOS_PREVIA);
  assert.equal(resumo[0].imagem_base64, undefined);
  assert.deepEqual(resumo[2], { id: 'f_2', categoria: 'encaminhamento', rotulo: 'Doc 3' });
});

test('classificarDocumentoPrevia routes SISREG docs to Regulacao and recipes to clinical sectors, and supports PDF attachments', () => {
  const sisregDoc = classificarDocumentoPrevia({
    destino_ia: 'sisreg',
    tipo_documento: 'ficha_ambulatorial',
    especialidade: 'Cardiologia > 14 anos',
    codigo_solicitacao: '684348188'
  });
  assert.equal(sisregDoc.categoria_destino, 'sisreg');
  assert.equal(sisregDoc.fila_destino, 'Regulação');
  assert.equal(sisregDoc.tipo_receita, 'sisreg');

  const recEnf = classificarDocumentoPrevia({
    destino_ia: 'receita',
    tipo_documento: 'receita_branca',
    tipo_receita: 'branca',
    medicamento: 'Losartana 50mg',
    data_emissao: '20/10/2026'
  }, new Date('2026-11-20T12:00:00Z'));
  assert.equal(recEnf.categoria_destino, 'receita');
  assert.equal(recEnf.fila_destino, 'Enfermagem');

  const fakePdf = 'data:application/pdf;base64,JVBERi0xLjQK';
  const normPdf = normalizarAnexosPrevia([{ id: 'p1', categoria: 'encaminhamento', nome_arquivo: 'ficha.pdf', imagem_base64: fakePdf }]);
  assert.equal(normPdf.length, 1);
  assert.equal(normPdf[0].mime_type, 'application/pdf');
  assert.equal(normPdf[0].nome_arquivo, 'ficha.pdf');
  const resumoPdf = resumirAnexosSemImagem(normPdf);
  assert.equal(resumoPdf[0].mime_type, 'application/pdf');
  assert.equal(resumoPdf[0].nome_arquivo, 'ficha.pdf');
});
