// Módulo Backend — Copiloto da Regulação (SISREG III · US 177 USF Chico Mendes · DS5)
const fs = require('fs');
const path = require('path');
const { checkRateLimit, getClientIp } = require('./seguranca');
const { executarOcrGeminiJson } = require('./ocr-ai');
const {
  classificarReceita,
  separarCnsECpf,
  formatarCepBR,
  formatarTelefoneBR,
  normalizarBairroUsf,
  decomporEnderecoPaciente
} = require('./receitas');

const SISREG_META_PADRAO = {
  versao: '25/11/2025',
  unidade: 'US 177 USF CHICO MENDES',
  cnes: '0000965',
  distrito: 'DS5',
  contato_nao_encontrado: 'Coordenador do DS5'
};

const CATALOGO_PADRAO_PATH = path.join(__dirname, '..', 'data', 'sisreg-catalogo-padrao.json');
const CACHE_TTL_MS = 60 * 1000;
let _catalogoCache = { data: null, loadedAt: 0 };
let _tabelaDevolucoesCriada = false;

function normSisreg(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function limparTextoHtml(str) {
  return String(str || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function repararMojibake(str) {
  if (!str) return '';
  let s = String(str);
  s = s
    .replace(/SÃ[\s\u0080-\u00a0]*FILIS/gi, 'SÍFILIS')
    .replace(/OBLÃ[\s\u0080-\u00a0]*QUO/gi, 'OBLÍQUO')
    .replace(/OBLÃ[\s\u0080-\u00a0]*QUA/gi, 'OBLÍQUA')
    .replace(/\bRADIORADIOGRAFIA\b/gi, 'RADIOGRAFIA')
    .replace(/\bALEGENO\b/gi, 'ALERGENO')
    .replace(/\bOBLIGUA\b/gi, 'OBLIQUA')
    .replace(/\bOFTALMOGIA\b/gi, 'OFTALMOLOGIA')
    .replace(/\bCORANIANA\b/gi, 'CORONARIANA');
  const mapa = [
    ['ÃƒÂ£', 'ã'], ['ÃƒÂ¡', 'á'], ['ÃƒÂ¢', 'â'], ['ÃƒÂ©', 'é'], ['ÃƒÂª', 'ê'],
    ['ÃƒÂ­', 'í'], ['ÃƒÂ³', 'ó'], ['ÃƒÂ´', 'ô'], ['ÃƒÂµ', 'õ'], ['ÃƒÂº', 'ú'],
    ['ÃƒÂ§', 'ç'], ['ÃƒÆ’O', 'ÃO'], ['ÃƒO', 'ÃO'], ['ÃƒÂ', 'Ã'],
    ['Ãƒ', 'Ã'], ['ÃŠ', 'Ê'], ['Ã“', 'Ó'], ['Ã‰', 'É'], ['Ã‡', 'Ç'],
    ['Ãš', 'Ú'], ['Ã”', 'Ô'], ['Ã•', 'Õ'], ['Ã‚', 'Â'], ['Ã\u0081', 'Á'],
    ['Ã\u0089', 'É'], ['Ã\u008d', 'Í'], ['Ã\u0093', 'Ó'], ['Ã\u009a', 'Ú'],
    ['Ã£', 'ã'], ['Ã¡', 'á'], ['Ã¢', 'â'], ['Ãª', 'ê'], ['Ã©', 'é'],
    ['Ã­', 'í'], ['Ã³', 'ó'], ['Ã´', 'ô'], ['Ãµ', 'õ'], ['Ãº', 'ú'],
    ['Ã§', 'ç'], ['Ã\u00a0', 'à']
  ];
  for (const [de, para] of mapa) {
    if (s.includes(de)) s = s.split(de).join(para);
  }
  s = s
    .replace(/Ã(?=\s+[A-Z])/g, 'Í')
    .replace(/\uFFFD/g, '');
  return s.replace(/\s+/g, ' ').trim();
}

function classificarTipoProcedimento(nome, hierarquia) {
  const gNorm = normSisreg(hierarquia).replace(/^[0-9.\-\s]+/, '');
  const nNorm = normSisreg(nome);
  const texto = `${gNorm} ${nNorm}`;
  if (
    nNorm.startsWith('consulta') ||
    nNorm.startsWith('primeira consulta') ||
    nNorm.startsWith('avaliacao em ') ||
    nNorm.startsWith('atendimento ') ||
    gNorm.includes('consulta') ||
    gNorm.includes('atendimento')
  ) {
    return 'Consulta';
  }
  if (
    texto.includes('diagnostico') ||
    texto.includes('diagnose') ||
    texto.includes('exame') ||
    texto.includes('patologia clinica') ||
    texto.includes('ultrasonografia') ||
    texto.includes('ultra-sonografia') ||
    texto.includes('ultrassonografia') ||
    texto.includes('ecografia') ||
    texto.includes('ecocardiografia') ||
    texto.includes('radiografia') ||
    texto.includes('raio x') ||
    texto.includes('tomografia') ||
    texto.includes('ressonancia') ||
    texto.includes('endoscopia') ||
    texto.includes('colonoscopia') ||
    texto.includes('retossigmoidoscopia') ||
    texto.includes('esofagogastro') ||
    texto.includes('mamografia') ||
    texto.includes('densitometria') ||
    texto.includes('eletrocardiograma') ||
    texto.includes('eletroencefalograma') ||
    texto.includes('eletroneuromiografia') ||
    texto.includes('espirometria') ||
    texto.includes('holter') ||
    texto.includes('mapa') ||
    texto.includes('monitorizacao') ||
    texto.includes('teste ergometrico') ||
    texto.includes('teste de esforco') ||
    texto.includes('uretrocistografia') ||
    texto.includes('urografia') ||
    texto.includes('colposcopia') ||
    texto.includes('vulvoscopia') ||
    texto.includes('videolaringoscopia') ||
    texto.includes('bera') ||
    texto.includes('urodinamica') ||
    texto.includes('urofluxometria') ||
    texto.includes('biopsia') ||
    texto.includes('puncao') ||
    texto.includes('dosagem') ||
    texto.includes('pesquisa de ')
  ) {
    return 'Exame';
  }
  return 'Procedimento';
}

function extrairCodigoBase(code) {
  const c = String(code || '').trim();
  const m = c.match(/^(\d{8,12})(?:[-.].+)?$/);
  return m ? m[1] : c;
}

function limparNomeProcedimento(nomeRaw, codeBase) {
  let n = repararMojibake(limparTextoHtml(nomeRaw));
  if (codeBase) {
    const reDup = new RegExp(`\\(\\s*${codeBase}(?:[-.][^)]+)?\\s*\\)`, 'g');
    n = n.replace(reDup, '').trim();
  }
  return n.replace(/\s+/g, ' ').replace(/\s*-\s*$/g, '').trim();
}

function limparHierarquia(hierRaw) {
  let h = repararMojibake(limparTextoHtml(hierRaw));
  h = h.replace(/^\s*\[[+\-]\]\s*/, '').trim();
  return h.replace(/\s+/g, ' ').trim();
}

function ehHierarquiaCompleta(h) {
  return String(h || '').includes('>');
}

function decodificarStringJsLiteral(rawLiteral) {
  if (!rawLiteral) return '';
  const inner = rawLiteral.slice(1, -1);
  return inner
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\n/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\\\\/g, '\\');
}

function parsearSampleProceduresHtml(html) {
  const out = [];
  const blockMatch = html.match(/const\s+sampleProcedures\s*=\s*\[([\s\S]*?)\];/);
  if (!blockMatch) return out;
  const body = blockMatch[1];
  const objRe = /\{([\s\S]*?)\}/g;
  let m;
  while ((m = objRe.exec(body)) !== null) {
    const objTxt = m[1];
    const getProp = (prop) => {
      const pRe = new RegExp(`${prop}\\s*:\\s*("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')`);
      const pm = objTxt.match(pRe);
      return pm ? decodificarStringJsLiteral(pm[1]) : '';
    };
    const rawCode = getProp('code');
    const code = extrairCodigoBase(rawCode);
    const name = limparNomeProcedimento(getProp('name'), code);
    const typeRaw = limparTextoHtml(getProp('type'));
    const statusRaw = limparTextoHtml(getProp('status')) || 'ATIVO';
    const hierarchy = limparHierarquia(getProp('hierarchy'));
    if (!name) continue;
    out.push({
      code,
      name,
      type: typeRaw || classificarTipoProcedimento(name, hierarchy),
      status: statusRaw,
      hierarchy
    });
  }
  return out;
}

function parsearDomHierarchyHtml(html) {
  const out = [];
  const startIdx = html.indexOf('class="procedure-hierarchy"');
  if (startIdx === -1) return out;
  const endIdx = html.indexOf('<script', startIdx);
  const section = html.slice(startIdx, endIdx !== -1 ? endIdx : undefined);

  const chunks = section.split(/<div\s+class="level-2"[^>]*>/i);
  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];
    const closeTitleIdx = chunk.indexOf('</div>');
    if (closeTitleIdx === -1) continue;
    const groupRaw = chunk.slice(0, closeTitleIdx);
    const listRaw = chunk.slice(closeTitleIdx + 6);
    const groupTitle = limparHierarquia(groupRaw);
    const codeInGroupMatch = groupTitle.match(/\(\s*(\d{8,12}[^)]*)\s*\)/);
    const groupCode = codeInGroupMatch ? extrairCodigoBase(codeInGroupMatch[1]) : '';

    const itemRe = /<div\s+class="procedure-item"[^>]*>([\s\S]*?)<span\s+class="procedure-code"[^>]*>([\s\S]*?)<\/span>\s*<\/div>/gi;
    let im;
    let countItems = 0;
    while ((im = itemRe.exec(listRaw)) !== null) {
      countItems++;
      const rawCode = limparTextoHtml(im[2]).replace(/[()]/g, '').trim();
      const code = extrairCodigoBase(rawCode);
      const name = limparNomeProcedimento(im[1], code);
      if (!name) continue;
      out.push({
        code,
        name,
        type: classificarTipoProcedimento(name, groupTitle),
        status: 'ATIVO',
        hierarchy: groupTitle
      });
    }

    if (countItems === 0 && groupTitle && groupCode) {
      let cleanStandalone = groupTitle.replace(/^\d+(?:\.\d+)*\.?\s*/, '').trim();
      if (codeInGroupMatch) {
        cleanStandalone = cleanStandalone.replace(codeInGroupMatch[0], ' ').replace(/\s*-\s*\(\s*/, ' - (').trim();
      }
      cleanStandalone = cleanStandalone.replace(/^[\s-]+|[\s-]+$/g, '').replace(/\(\s*([^)]+)\s*\)/g, '$1').replace(/\s+/g, ' ').trim();
      if (cleanStandalone) {
        out.push({
          code: groupCode,
          name: cleanStandalone,
          type: classificarTipoProcedimento(cleanStandalone, groupTitle),
          status: 'ATIVO',
          hierarchy: groupTitle
        });
      }
    }
  }
  return out;
}

function decodificarBufferHtmlSisreg(input) {
  if (Buffer.isBuffer(input)) {
    if (input.length >= 2 && input[0] === 0xff && input[1] === 0xfe) {
      return input.slice(2).toString('utf16le');
    }
    if (input.length >= 2 && input[0] === 0xfe && input[1] === 0xff) {
      const swapped = Buffer.allocUnsafe(input.length - 2);
      for (let i = 2; i + 1 < input.length; i += 2) {
        swapped[i - 2] = input[i + 1];
        swapped[i - 1] = input[i];
      }
      return swapped.toString('utf16le');
    }
    let zeroEven = 0;
    const sample = Math.min(input.length, 400);
    for (let i = 1; i < sample; i += 2) {
      if (input[i] === 0) zeroEven++;
    }
    if (zeroEven > sample / 6) {
      return input.toString('utf16le').replace(/^\uFEFF/, '');
    }
    return input.toString('utf8').replace(/^\uFEFF/, '');
  }
  let s = String(input || '').replace(/^\uFEFF/, '');
  if (s.includes('\u0000')) {
    s = s.replace(/\u0000/g, '').replace(/^\uFFFE|^\uFEFF/g, '');
  }
  return s;
}

function parsearHtmlCatalogoSisreg(htmlInput) {
  const html = decodificarBufferHtmlSisreg(htmlInput);
  if (!html || typeof html !== 'string') {
    throw new Error('Conteúdo HTML inválido para importação do catálogo SISREG.');
  }
  const domItems = parsearDomHierarchyHtml(html);
  const sampleItems = parsearSampleProceduresHtml(html);

  const versaoMatch = html.match(/Atualizado:\s*(\d{2}\/\d{2}\/\d{2,4})/i);
  let versao = SISREG_META_PADRAO.versao;
  if (versaoMatch) {
    const p = versaoMatch[1].split('/');
    versao = p[2].length === 2 ? `${p[0]}/${p[1]}/20${p[2]}` : versaoMatch[1];
  }

  const mapa = new Map();
  const registrar = (item, origemDom) => {
    const code = extrairCodigoBase(item.code);
    const name = limparNomeProcedimento(item.name, code);
    if (!name) return;
    const nameNorm = normSisreg(name);
    const key = `${code}|${nameNorm}`;
    const tipo = ['Consulta', 'Exame', 'Procedimento'].includes(item.type)
      ? item.type
      : classificarTipoProcedimento(name, item.hierarchy);

    const existing = mapa.get(key);
    if (!existing) {
      mapa.set(key, {
        code,
        name,
        type: tipo,
        status: item.status || 'ATIVO',
        hierarchy: item.hierarchy || ''
      });
      return;
    }

    // Preferir hierarquia completa (com ">") vinda do sampleProcedures, mas preservar nome completo do DOM
    if (ehHierarquiaCompleta(item.hierarchy) && !ehHierarquiaCompleta(existing.hierarchy)) {
      existing.hierarchy = item.hierarchy;
    } else if (!existing.hierarchy && item.hierarchy) {
      existing.hierarchy = item.hierarchy;
    }
    if (origemDom && name.length > existing.name.length) {
      existing.name = name;
    }
    if (tipo !== 'Procedimento' && existing.type === 'Procedimento') {
      existing.type = tipo;
    }
  };

  domItems.forEach(it => registrar(it, true));
  sampleItems.forEach(it => {
    // Evitar sobrescrever/duplicar nomes truncados vindos do sampleProcedures se já existe prefixo no DOM
    const code = extrairCodigoBase(it.code);
    const sNorm = normSisreg(it.name);
    let prefixHitKey = null;
    if (sNorm.length >= 25) {
      for (const [k, v] of mapa.entries()) {
        if (v.code === code) {
          const eNorm = normSisreg(v.name);
          if (eNorm.startsWith(sNorm) || sNorm.startsWith(eNorm)) {
            prefixHitKey = k;
            break;
          }
        }
      }
    }
    if (prefixHitKey) {
      const ex = mapa.get(prefixHitKey);
      if (ehHierarquiaCompleta(it.hierarchy) && !ehHierarquiaCompleta(ex.hierarchy)) {
        ex.hierarchy = it.hierarchy;
      }
      if (it.name.length > ex.name.length) {
        ex.name = it.name;
      }
    } else {
      registrar(it, false);
    }
  });

  // Se houver resultado inicial BERA na tabela de exemplo HTML fora do sampleProcedures
  if (html.includes('0211070262') && !Array.from(mapa.values()).some(p => p.code === '0211070262')) {
    mapa.set('0211070262|bera - potencial evocado auditivo de curta media e longa', {
      code: '0211070262',
      name: 'BERA - POTENCIAL EVOCADO AUDITIVO DE CURTA MEDIA E LONGA',
      type: 'Exame',
      status: 'ATIVO',
      hierarchy: '1. Procedimento Ambulatorial > 1.1 GRUPO - DIAGNOSE EM OTORRINOLARINGOLOGIA/FONOAUDIOLOGIA'
    });
  }

  const procedimentos = Array.from(mapa.values()).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  return {
    versao,
    unidade: SISREG_META_PADRAO.unidade,
    cnes: SISREG_META_PADRAO.cnes,
    distrito: SISREG_META_PADRAO.distrito,
    contato_nao_encontrado: SISREG_META_PADRAO.contato_nao_encontrado,
    atualizado_em: new Date().toISOString(),
    total: procedimentos.length,
    procedimentos
  };
}

function validarCNS(cnsRaw) {
  const limpo = String(cnsRaw || '').replace(/\D/g, '');
  if (!limpo) {
    return { valido: null, limpo: '', formatado: '', motivo: 'CNS não informado' };
  }
  const formatado = limpo.replace(/(\d{3})(\d{4})(\d{4})(\d{4})/, '$1 $2 $3 $4').trim();
  if (limpo.length !== 15) {
    return { valido: false, limpo, formatado, motivo: `CNS com ${limpo.length} dígitos (esperado: 15)` };
  }
  if (/^(\d)\1{14}$/.test(limpo)) {
    return { valido: false, limpo, formatado, motivo: 'CNS com dígitos repetidos inválidos' };
  }

  const primeiro = limpo[0];
  let ok = false;
  if (primeiro === '1' || primeiro === '2') {
    const pis = limpo.substring(0, 11);
    let soma = 0;
    for (let i = 0; i < 11; i++) {
      soma += parseInt(pis[i], 10) * (15 - i);
    }
    let resto = soma % 11;
    let dv = 11 - resto;
    if (dv === 11) dv = 0;
    let resultado = '';
    if (dv === 10) {
      soma += 2;
      resto = soma % 11;
      dv = 11 - resto;
      resultado = `${pis}001${dv}`;
    } else {
      resultado = `${pis}000${dv}`;
    }
    ok = resultado === limpo;
  } else if (primeiro === '7' || primeiro === '8' || primeiro === '9') {
    let soma = 0;
    for (let i = 0; i < 15; i++) {
      soma += parseInt(limpo[i], 10) * (15 - i);
    }
    ok = soma % 11 === 0;
  }

  return {
    valido: ok,
    limpo,
    formatado,
    motivo: ok ? 'CNS válido (dígito verificador OK)' : 'Dígito verificador do CNS inválido — confira o número!'
  };
}

function validarTelefoneBR(telRaw) {
  let digits = String(telRaw || '').replace(/\D/g, '');
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    digits = digits.slice(2);
  }
  if (!digits) {
    return {
      valido: false,
      celular: false,
      formatado: '',
      somenteDigitos: '',
      alerta: 'Telefone ausente — confirme com o usuário para o SISREG notificar o agendamento!'
    };
  }
  let dddInferido = false;
  if (digits.length === 9 && digits.startsWith('9')) {
    digits = `81${digits}`;
    dddInferido = true;
  } else if (digits.length === 8) {
    digits = `81${digits}`;
    dddInferido = true;
  }

  if (digits.length === 11 && digits[2] === '9') {
    const fmt = `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
    return {
      valido: true,
      celular: true,
      formatado: fmt,
      somenteDigitos: digits,
      alerta: dddInferido ? 'DDD 81 preenchido automaticamente — confirme com o usuário.' : null
    };
  }
  if (digits.length === 10) {
    const fmt = `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return {
      valido: true,
      celular: false,
      formatado: fmt,
      somenteDigitos: digits,
      alerta: 'Telefone fixo/sem dígito 9 — se possível, atualize para o celular do paciente.'
    };
  }

  return {
    valido: false,
    celular: false,
    formatado: String(telRaw || '').trim(),
    somenteDigitos: digits,
    alerta: `Telefone incompleto (${digits.length} dígitos) — atualize antes de lançar no SISREG!`
  };
}

const CIDADES_RMR_FORA_RECIFE = [
  { rx: /\bolinda\b/, nome: 'Olinda' },
  { rx: /\bjaboatao(?:\s+dos\s+guararapes)?\b/, nome: 'Jaboatão dos Guararapes' },
  { rx: /\bcamaragibe\b/, nome: 'Camaragibe' },
  { rx: /\bpaulista\b/, nome: 'Paulista' },
  { rx: /\bsao\s+lourenco(?:\s+da\s+mata)?\b/, nome: 'São Lourenço da Mata' },
  { rx: /\babreu\s+e\s+lima\b/, nome: 'Abreu e Lima' },
  { rx: /\bigarassu\b/, nome: 'Igarassu' },
  { rx: /\bmoreno\b/, nome: 'Moreno' },
  { rx: /\bcabo(?:\s+de\s+santo\s+agostinho)?\b/, nome: 'Cabo de Santo Agostinho' },
  { rx: /\bitapissuma\b/, nome: 'Itapissuma' },
  { rx: /\bitamaraca\b/, nome: 'Ilha de Itamaracá' },
  { rx: /\bipojuca\b/, nome: 'Ipojuca' },
  { rx: /\baracoiaba\b/, nome: 'Araçoiaba' },
  { rx: /\bvitoria\s+de\s+santo\s+antao\b/, nome: 'Vitória de Santo Antão' },
  { rx: /\bcaruaru\b/, nome: 'Caruaru' }
];

function identificarCidadePorCepPE(cepNum) {
  if (cepNum >= 53000000 && cepNum <= 53399999) return 'Olinda';
  if (cepNum >= 53400000 && cepNum <= 53499999) return 'Paulista';
  if (cepNum >= 53500000 && cepNum <= 53599999) return 'Abreu e Lima';
  if (cepNum >= 53600000 && cepNum <= 53699999) return 'Igarassu';
  if (cepNum >= 54000000 && cepNum <= 54499999) return 'Jaboatão dos Guararapes';
  if (cepNum >= 54500000 && cepNum <= 54599999) return 'Cabo de Santo Agostinho';
  if (cepNum >= 54700000 && cepNum <= 54749999) return 'São Lourenço da Mata';
  if (cepNum >= 54750000 && cepNum <= 54799999) return 'Camaragibe';
  return null;
}

function verificarEnderecoRecife({ municipio, uf, cep, endereco, bairro } = {}) {
  const munNorm = normSisreg(municipio);
  const ufNorm = normSisreg(uf);
  const endNorm = normSisreg(endereco);
  const bairroNorm = normalizarBairroUsf(bairro, endereco);
  const ehBairroRecifeUsf = ['Caçote', 'Areias', 'Estância'].includes(bairroNorm);
  const cepDigits = String(cep || '').replace(/\D/g, '');
  const motivos = [];

  if (ufNorm && ufNorm !== 'pe' && ufNorm !== 'pernambuco') {
    motivos.push(`UF "${String(uf).trim().toUpperCase()}" diferente de PE`);
  }

  if (munNorm && munNorm !== 'recife') {
    motivos.push(`Município informado: "${String(municipio).trim()}" (Central exige Recife - PE)`);
  }

  if (cepDigits.length === 8) {
    const cepNum = parseInt(cepDigits, 10);
    if (cepNum < 50000000 || cepNum > 52999999) {
      const cidadeProv = identificarCidadePorCepPE(cepNum);
      const cepFmt = `${cepDigits.slice(0, 5)}-${cepDigits.slice(5)}`;
      motivos.push(
        `CEP ${cepFmt} está fora da faixa de Recife (50000-000 a 52999-999)${cidadeProv ? ` — provável ${cidadeProv}` : ''}`
      );
    }
  } else if (cepDigits.length > 0 && cepDigits.length !== 8) {
    motivos.push(`CEP incompleto (${cepDigits})`);
  }

  if (endNorm) {
    for (const c of CIDADES_RMR_FORA_RECIFE) {
      if (c.rx.test(endNorm)) {
        // Evitar falso positivo com nomes de rua que citam cidades se o município já for explicitamente Recife e o CEP for de Recife
        const temRuaAvenida = new RegExp(`\\b(?:rua|av|avenida|travessa|estrada)\\s+[^,]*${c.rx.source}`, 'i').test(endNorm);
        if (!temRuaAvenida || (munNorm && munNorm !== 'recife')) {
          motivos.push(`Endereço menciona "${c.nome}"`);
          break;
        }
      }
    }
  }

  if (motivos.length > 0) {
    return {
      status: 'fora_recife',
      recifeOk: false,
      alerta: `🚫 Risco de DEVOLUÇÃO por endereço fora de Recife: ${motivos.join(' · ')}`,
      motivos
    };
  }

  if (!munNorm && cepDigits.length !== 8 && !endNorm && !ehBairroRecifeUsf) {
    return {
      status: 'incompleto',
      recifeOk: null,
      alerta: 'Endereço/Município não visível na ficha — confirme se o paciente reside em Recife - PE.',
      motivos: []
    };
  }

  return {
    status: 'ok',
    recifeOk: true,
    alerta: null,
    motivos: []
  };
}

function calcularIdadeDataBR(dnStr, refDate = new Date()) {
  const m = String(dnStr || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const dia = parseInt(m[1], 10);
  const mes = parseInt(m[2], 10);
  const ano = parseInt(m[3], 10);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || ano < 1900 || ano > 2100) return null;

  const hojeStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Recife',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(refDate);
  const [hy, hm, hd] = hojeStr.split('-').map(Number);
  let idade = hy - ano;
  if (hm < mes || (hm === mes && hd < dia)) idade--;
  return idade >= 0 && idade <= 125 ? idade : null;
}

const SINONIMOS_SISREG = {
  usg: ['ultrassonografia', 'ultra-sonografia', 'ecografia'],
  us: ['ultrassonografia', 'ultra-sonografia'],
  ultrassom: ['ultrassonografia', 'ultra-sonografia'],
  ultrassonografia: ['ultra-sonografia', 'ultrassonografia'],
  'ultra-sonografia': ['ultrassonografia', 'ultra-sonografia'],
  eco: ['ecocardiografia', 'ecocardiograma'],
  ecott: ['ecocardiografia'],
  ecocardiograma: ['ecocardiografia'],
  ecg: ['eletrocardiograma'],
  eeg: ['eletroencefalograma'],
  enmg: ['eletroneuromiografia'],
  emg: ['eletroneuromiografia'],
  tc: ['tomografia', 'tomografia computadorizada'],
  tomo: ['tomografia'],
  rnm: ['ressonancia', 'ressonancia magnetica'],
  rm: ['ressonancia', 'ressonancia magnetica'],
  rx: ['radiografia', 'raio x'],
  'raio-x': ['radiografia', 'raio x'],
  raiox: ['radiografia', 'raio x'],
  eda: ['endoscopia digestiva alta', 'esofagogastroduodenoscopia'],
  colono: ['colonoscopia'],
  reto: ['retossigmoidoscopia'],
  bera: ['bera', 'potencial evocado auditivo'],
  peate: ['potencial evocado auditivo', 'bera'],
  mapa: ['monitorizacao ambulatorial de pressao arterial'],
  holter: ['holter'],
  espiro: ['espirometria', 'prova de funcao pulmonar'],
  densi: ['densitometria'],
  dmo: ['densitometria'],
  mamo: ['mamografia'],
  mmg: ['mamografia'],
  oftalmo: ['oftalmologia', 'oftalmo'],
  cardio: ['cardiologia', 'cardiologico'],
  dermato: ['dermatologia', 'dermatologica'],
  neuro: ['neurologia', 'neurologica'],
  orto: ['ortopedia', 'traumato-ortopedia', 'traumato'],
  traumato: ['traumato-ortopedia', 'ortopedia'],
  uro: ['urologia', 'urodinamica', 'urografia', 'uretrocistografia', 'urofluxometria'],
  gineco: ['ginecologia', 'ginecologica'],
  go: ['ginecologia', 'obstetricia'],
  gastro: ['gastroenterologia'],
  endocrino: ['endocrinologia'],
  pneumo: ['pneumologia'],
  reumato: ['reumatologia'],
  otorrino: ['otorrinolaringologia', 'otorrino'],
  orl: ['otorrinolaringologia', 'otorrino'],
  masto: ['mastologia'],
  nefro: ['nefrologia'],
  procto: ['proctologia'],
  angio: ['angiologia', 'cirurgia vascular'],
  vascular: ['cirurgia vascular', 'angiologia'],
  psiq: ['psiquiatria'],
  psiquiatra: ['psiquiatria'],
  psico: ['psicologia'],
  fisio: ['fisioterapia', 'fisioterapeutico'],
  fono: ['fonoaudiologia'],
  nutri: ['nutricao'],
  hemato: ['hematologia'],
  hepato: ['hepatologia', 'hepatites'],
  infecto: ['infectologia'],
  geriatria: ['geriatria'],
  ped: ['pediatria', 'pediatrica'],
  buco: ['buco-maxilo', 'buco maxilo'],
  tv: ['transvaginal'],
  doppler: ['doppler', 'colorido'],
  mid: ['m i d', 'mid'],
  mie: ['m i e', 'mie'],
  msd: ['m s d', 'msd'],
  mse: ['m s e', 'mse'],
  psa: ['antigeneo prostatico', 'psa'],
  tsh: ['tireoestimulante', 'tsh'],
  hba1c: ['hemoglobina glicosilada', 'hbgl'],
  eas: ['sumario de urina', 'eas'],
  iono: ['sodio', 'potassio', 'iono'],
  lipidograma: ['colesterol'],
  vdrl: ['vdrl', 'sifilis'],
  laboratorio: ['exames de laboratorio', 'patologia clinica'],
  lab: ['exames de laboratorio', 'patologia clinica'],
  'exames de laboratorio': ['exames de laboratorio', 'patologia clinica']
};

const STOPWORDS_BUSCA = new Set(['de', 'da', 'do', 'dos', 'das', 'em', 'para', 'p/', 'com', 'c/', 'sem', 'e', 'ou', 'a', 'o', 'os', 'as', 'ao', 'no', 'na']);
const SIGLAS_SO_SINONIMO = new Set(['tc', 'tomo', 'rnm', 'rm', 'usg', 'us', 'eco', 'ecott', 'eda', 'espiro', 'densi', 'dmo', 'mamo', 'mmg', 'orl', 'go', 'tv', 'colono', 'reto', 'peate', 'ped', 'lab', 'laboratorio']);
const SIGLAS_EXATAS = new Set(['bera', 'mapa', 'ecg', 'eeg', 'enmg', 'emg', 'psa', 'tsh', 'hba1c', 'hbgl', 'eas', 'vdrl', 'iono', 'rx', 'mid', 'mie', 'msd', 'mse']);

function escRxSisreg(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function correspondeVarianteSisreg(texto, variante) {
  if (!texto || !variante) return false;
  if (variante.startsWith('>') || variante.startsWith('<')) {
    return texto.includes(variante);
  }
  if (variante.includes(' ')) {
    if (new RegExp(`(?:^|[^a-z0-9])${escRxSisreg(variante)}(?:$|[^a-z0-9])`).test(texto)) {
      return true;
    }
    const words = variante.split(/\s+/).filter(w => w.length > 1 && !STOPWORDS_BUSCA.has(w));
    return words.length > 0 && words.every(w => new RegExp(`(?:^|[^a-z0-9])${escRxSisreg(w)}`).test(texto));
  }
  if (SIGLAS_EXATAS.has(variante) || variante.length <= 2) {
    return new RegExp(`(?:^|[^a-z0-9])${escRxSisreg(variante)}(?:$|[^a-z0-9])`).test(texto);
  }
  return new RegExp(`(?:^|[^a-z0-9])${escRxSisreg(variante)}`).test(texto);
}

function expandirConsultaSisreg(rawQuery) {
  const base = normSisreg(rawQuery)
    .replace(/ultra[\s-]*sonograf[ia]+/g, 'ultrassonografia')
    .replace(/\braio[\s-]*x\b/g, 'radiografia');
  const tokensRaw = base.split(/[^a-z0-9<>]+/).filter(Boolean);
  const tokens = tokensRaw.filter(t => !STOPWORDS_BUSCA.has(t));
  const grupos = tokens.map(tok => {
    const set = new Set();
    if (!SIGLAS_SO_SINONIMO.has(tok) || !SINONIMOS_SISREG[tok]) {
      set.add(tok);
    }
    if (tok === 'ultrassonografia') set.add('ultra-sonografia');
    const syns = SINONIMOS_SISREG[tok];
    if (Array.isArray(syns)) {
      syns.forEach(s => {
        const sn = normSisreg(s);
        if (sn) set.add(sn);
      });
    }
    return { original: tok, variantes: Array.from(set) };
  });
  return { base, grupos };
}

function classificarFaixaEtariaSisreg(nomeNorm, hierNorm) {
  const txt = `${nomeNorm} ${hierNorm}`.replace(/\s+/g, ' ').trim();
  const isMistoAdultoInfantil = /\badulto ou infantil\b|\binfantil ou adulto\b/.test(txt);
  const isTeen14a17 = /\b14 a 17\s*anos?\b|\binfanto[\s-]*puberal\b|\b10 a 17\s*anos?\b/.test(txt);
  const isPed = !isMistoAdultoInfantil && (
    /\bpediatr|\binfant|\bneonat|\bmicrocefalia|\bhebiatria|\btetse do olhinho|\bteste do olhinho/.test(txt) ||
    /\b0 a 1[0-4]\b|\b0 a [1-9]\b|\b2 a 1[0-4]\b|\b5 a 13\b|<\s*[1-9]\s*anos?\b|<\s*1[0-4]\s*anos?\b/.test(txt) ||
    /(?:^|[\s\-(])(?:[1-9]|1[0-4])\s*anos?(?:\b|$)/.test(nomeNorm.replace(/>\s*\d+\s*anos?/g, '').replace(/\d+\s*a\s*\d+\s*anos?/g, '').replace(/a partir de \d+\s*anos?/g, '')) ||
    isTeen14a17
  );
  const isIdoso = />\s*60\b|\bgeriatr/.test(txt);
  const isFaixaAdultoCap59 = /\b1[48]\s*a\s*59\s*anos?\b/.test(txt);
  const isAdultoMaior = !isMistoAdultoInfantil && (
    />\s*1[4-8]\b|\badulto\b|\badultos\b/.test(txt) || isFaixaAdultoCap59 || isTeen14a17
  );
  return { isPed, isTeen14a17, isIdoso, isFaixaAdultoCap59, isAdultoMaior, isMistoAdultoInfantil };
}

function compativelFaixaEtariaEVaga(nomeNorm, hierNorm, { idade, tipoVaga } = {}) {
  if (tipoVaga === 'retorno' || tipoVaga === 'primeira_vez') {
    const isRetorno = /\bretorno\b/.test(nomeNorm);
    if (tipoVaga === 'retorno' && !isRetorno) return false;
    if (tipoVaga === 'primeira_vez' && isRetorno) return false;
  }
  if (idade !== null && idade !== undefined && String(idade).trim() !== '' && Number.isFinite(Number(idade))) {
    const id = Number(idade);
    const { isPed, isTeen14a17, isIdoso, isAdultoMaior } = classificarFaixaEtariaSisreg(nomeNorm, hierNorm);
    if (id <= 14) {
      if ((isAdultoMaior && !isTeen14a17) || isIdoso) return false;
    } else if (id >= 60) {
      if (isPed || /\b1[48]\s*a\s*59\s*anos?\b/.test(`${nomeNorm} ${hierNorm}`)) return false;
    } else {
      if ((isPed && !isTeen14a17) || isIdoso) return false;
    }
  }
  return true;
}

function pontuarFaixaEtaria(nomeNorm, hierNorm, idade) {
  if (idade === null || idade === undefined || !Number.isFinite(Number(idade))) return 0;
  const id = Number(idade);
  const { isPed, isTeen14a17, isIdoso, isAdultoMaior } = classificarFaixaEtariaSisreg(nomeNorm, hierNorm);

  if (id <= 14) {
    if (isPed) return isTeen14a17 ? 20 : 45;
    if (isAdultoMaior || isIdoso) return -35;
  } else if (id >= 60) {
    if (isIdoso) return 45;
    if (isPed) return -50;
    if (isAdultoMaior) return 15;
  } else {
    if (isAdultoMaior) return isTeen14a17 ? 20 : 35;
    if (isPed || isIdoso) return -35;
  }
  return 0;
}

function buscarProcedimentosSisreg(procedimentos, query, opts = {}) {
  const lista = Array.isArray(procedimentos) ? procedimentos : [];
  const qStr = String(query || '').trim();
  const tipoFiltro = opts.tipo && opts.tipo !== 'all' ? opts.tipo : null;
  const idade = opts.idade !== undefined && opts.idade !== null && opts.idade !== '' ? Number(opts.idade) : null;
  const tipoVaga = opts.tipoVaga || null;
  const limite = Number(opts.limite) > 0 ? Number(opts.limite) : 20;

  if (!qStr) {
    const temIdade = idade !== null && Number.isFinite(idade);
    const temVaga = tipoVaga === 'retorno' || tipoVaga === 'primeira_vez';
    const filtrados = lista
      .filter(p => {
        if (tipoFiltro && p.type !== tipoFiltro) return false;
        const nameRawNorm = normSisreg(p.name);
        const hierNorm = normSisreg(p.hierarchy || '');
        return compativelFaixaEtariaEVaga(nameRawNorm, hierNorm, { idade, tipoVaga });
      })
      .map(p => {
        const nameRawNorm = normSisreg(p.name);
        const hierNorm = normSisreg(p.hierarchy || '');
        const isRetorno = /\bretorno\b/.test(nameRawNorm);
        let score = 1;
        if (temIdade) score += pontuarFaixaEtaria(nameRawNorm, hierNorm, idade);
        if (tipoVaga === 'retorno') score += isRetorno ? 40 : 0;
        else if (tipoVaga === 'primeira_vez') score += isRetorno ? -25 : 15;
        return { ...p, score };
      });
    if (temIdade || temVaga) {
      filtrados.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'pt-BR'));
    }
    return filtrados.slice(0, limite);
  }

  const qDigits = qStr.replace(/\D/g, '');
  const { base, grupos } = expandirConsultaSisreg(qStr);
  const resultados = [];

  for (const proc of lista) {
    if (tipoFiltro && proc.type !== tipoFiltro) continue;
    const code = String(proc.code || '');
    const codeNorm = normSisreg(code);
    const nameRawNorm = normSisreg(proc.name);
    const nameUnified = nameRawNorm
      .replace(/ultra[\s-]*sonograf[ia]+/g, 'ultrassonografia')
      .replace(/\braio[\s-]*x\b/g, 'radiografia');
    const hierNorm = normSisreg(proc.hierarchy || '');
    if (!compativelFaixaEtariaEVaga(nameRawNorm, hierNorm, { idade, tipoVaga })) continue;
    const fullText = `${nameRawNorm} ${nameUnified} ${hierNorm} ${codeNorm}`;

    let score = 0;
    if (qDigits.length >= 6 && codeNorm.includes(qDigits)) {
      score += codeNorm === qDigits ? 200 : 140;
    }

    if (score === 0 && grupos.length > 0) {
      let matchedGroups = 0;
      for (const g of grupos) {
        const hitName = g.variantes.some(v => correspondeVarianteSisreg(nameRawNorm, v) || correspondeVarianteSisreg(nameUnified, v));
        const hitHier = !hitName && g.variantes.some(v => correspondeVarianteSisreg(hierNorm, v));
        const hitCode = g.original.length >= 4 && /^\d+$/.test(g.original) && codeNorm.includes(g.original);
        if (hitName) {
          matchedGroups++;
          score += g.variantes[0] === g.original && correspondeVarianteSisreg(nameRawNorm, g.original) ? 35 : 28;
        } else if (hitHier || hitCode) {
          matchedGroups++;
          score += 18;
        }
      }
      if (matchedGroups < grupos.length) continue;
      if ((!SIGLAS_SO_SINONIMO.has(base) || !SINONIMOS_SISREG[base]) &&
          (correspondeVarianteSisreg(nameRawNorm, base) || correspondeVarianteSisreg(nameUnified, base))) {
        score += 30;
      }
    } else if (score === 0) {
      if (!fullText.includes(base)) continue;
      score = 20;
    }

    score += pontuarFaixaEtaria(nameRawNorm, hierNorm, idade);

    const isRetorno = /\bretorno\b/.test(nameRawNorm);
    if (tipoVaga === 'retorno') {
      score += isRetorno ? 40 : -10;
    } else if (tipoVaga === 'primeira_vez') {
      score += isRetorno ? -25 : 15;
    }

    if (ehHierarquiaCompleta(proc.hierarchy)) score += 5;

    resultados.push({ ...proc, score });
  }

  resultados.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'pt-BR'));
  return resultados.slice(0, limite);
}

function formatarObservacaoSisreg(texto, semAcentoMaiusculo = false) {
  let s = String(texto || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (semAcentoMaiusculo) {
    s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  }
  return s;
}

const PROMPT_OCR_FICHA_SISREG = `Você é um especialista em Regulação Ambulatorial do SUS (SISREG III - Recife/PE).
Analise a imagem ou PDF enviado (que pode ser uma Ficha de Solicitação Ambulatorial manuscrita/impressa, um Encaminhamento Médico, Pedido de Exame ou um comprovante/espelho PDF do SISREG III) e extraia os dados em JSON estrito:
{
  "tipo_arquivo": "ficha_ambulatorial" | "pdf_sisreg" | "encaminhamento" | "pedido_exame" | "receita_branca" | "receita_azul" | "receita_odonto" | "outro",
  "codigo_solicitacao": "código da solicitação se for PDF do SISREG, senão null",
  "status_documento_sisreg": "DEVOLVIDO" | "PENDENTE" | "SOLICITADO" | "AUTORIZADO" | "CANCELADO" | null,
  "documento_devolvido": true | false,
  "historico_observacoes": [
    {
      "papel": "solicitante" | "regulador" | "outro",
      "autor": "nome do operador/médico se visível, senão null",
      "data": "DD/MM/AAAA (e hora se houver) se visível, senão null",
      "texto": "texto exato da observação ou parecer daquele bloco"
    }
  ],
  "observacao_solicitante": "texto clínico escrito apenas pelo Solicitante (sem misturar parecer do Regulador), ou null" | null,
  "parecer_regulador": "se devolvido/pendente, o texto exato da exigência ou devolução escrita pelo Regulador, senão null" | null,
  "data_devolucao_regulador": "DD/MM/AAAA da análise/devolução do Regulador, se houver" | null,
  "nome_regulador": "nome/identificação do Regulador se visível" | null,
  "medicamentos": "se o documento for um receituário/prescrição de medicamentos, lista de medicamentos com dosagem separados por vírgula; senão null" | null,
  "itens_posologia": [{"medicamento": "nome do remédio", "quantidade_total": número total de comprimidos/cápsulas prescritos ou null, "dose_diaria": número de comprimidos por dia (ex: 12/12h = 2, 8/8h = 3, 1x/dia = 1) ou null, "quantidade_ja_retirada": número já retirado na farmácia se anotado na receita ou null}],
  "data_emissao_receita": "DD/MM/AAAA se for receituário, senão null" | null,
  "paciente_nome": "nome completo do paciente" | null,
  "paciente_cns": "Cartão Nacional de Saúde (15 dígitos) — NÃO misturar com CPF" | null,
  "paciente_cpf": "CPF do paciente (11 dígitos, ex: 000.000.000-00) se visível" | null,
  "paciente_rg": "RG se visível" | null,
  "paciente_dn": "DD/MM/AAAA se visível" | null,
  "paciente_sexo": "M" | "F" | null,
  "paciente_mae": "nome da mãe se visível" | null,
  "paciente_telefone": "telefone/WhatsApp com DDD se visível" | null,
  "paciente_endereco": "logradouro (Rua, Avenida, Travessa) sem repetir número, bairro, município, UF ou CEP quando separados" | null,
  "paciente_numero": "número do imóvel (ex: 123, S/N) se visível" | null,
  "paciente_complemento": "complemento (Casa, Apto, Bloco, Fundos) se visível" | null,
  "paciente_bairro": "bairro (esta USF atende os bairros Caçote, Areias e Estância em Recife/PE; corrija grafias manuscritas próximas para Caçote, Areias ou Estância quando for claramente um deles)" | null,
  "paciente_cep": "CEP (8 dígitos, ex: 50000-000) se visível" | null,
  "paciente_municipio": "nome do município se visível" | null,
  "paciente_uf": "sigla UF (ex: PE)" | null,
  "tipo_vaga": "primeira_vez" | "retorno" | null,
  "risco": "azul" | "verde" | "amarelo" | "vermelho" | null,
  "especialidade_ou_exame": "especialidade médica ou nome do procedimento/exame principal solicitado" | null,
  "procedimentos_pedidos": ["lista curta com cada procedimento, exame ou especialidade pedida na ficha"],
  "hipotese_diagnostica": "hipótese diagnóstica / diagnóstico inicial" | null,
  "cid10": "código CID-10 (ex: N84.0, I10)" | null,
  "medico_solicitante": "nome do profissional solicitante" | null,
  "crm_conselho": "CRM / COREN / CRO se visível" | null,
  "data_solicitacao": "DD/MM/AAAA" | null,
  "tem_assinatura_carimbo": true | false | null,
  "observacoes_original": "transcrição fiel de Condições Clínicas / Justificativa / Observações / Histórico Clínico exatamente como está escrito na ficha",
  "observacoes_revisada": "versão limpa e corrigida para colar no SISREG III usando apenas a observação clínica do Solicitante (NÃO inclua parecer de devolução do Regulador aqui); corrija apenas erros óbvios de digitação/ortografia e pontuação, NUNCA invente dados clínicos novos. Se alguma palavra manuscrita estiver difícil/ilegível, sinalize como [CONFERIR: palavra?]",
  "alertas_digitacao": ["lista de avisos curtos sobre correções ortográficas feitas ou palavras ilegíveis que precisam de conferência"],
  "confianca": 0
}
ATENÇÃO PARA ESPELHOS/PDFs DO SISREG III:
- Verifique se o documento foi DEVOLVIDO (ex: Situação/Status DEVOLVIDO, Motivo de Devolução, ou bloco no Histórico de Observações com "Regulador:" e "Data:").
- No "Histórico de Observações", geralmente existe bloco "Solicitante:" (com texto clínico e data) e, quando devolvido, um bloco "Regulador:" com "Data:" e o motivo da devolução. Separe cada ator em "historico_observacoes".
Retorne null nos campos não encontrados e [] nas listas vazias.`;

async function carregarCatalogoSisregAtivo(pool) {
  const now = Date.now();
  if (_catalogoCache.data && (now - _catalogoCache.loadedAt) < CACHE_TTL_MS) {
    return _catalogoCache.data;
  }

  if (pool) {
    try {
      const r = await pool.query(`SELECT valor FROM configuracoes WHERE chave = 'sisreg_catalogo_json'`);
      const raw = r.rows[0]?.valor;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.procedimentos) && parsed.procedimentos.length > 0) {
          const out = {
            ...SISREG_META_PADRAO,
            ...parsed,
            unidade: SISREG_META_PADRAO.unidade,
            cnes: SISREG_META_PADRAO.cnes,
            distrito: SISREG_META_PADRAO.distrito,
            contato_nao_encontrado: SISREG_META_PADRAO.contato_nao_encontrado,
            origem: 'personalizado',
            total: parsed.procedimentos.length
          };
          _catalogoCache = { data: out, loadedAt: now };
          return out;
        }
      }
    } catch (err) {
      console.warn('[sisreg] Aviso ao ler catálogo do banco:', err.message);
    }
  }

  try {
    const fileRaw = fs.readFileSync(CATALOGO_PADRAO_PATH, 'utf8');
    const parsed = JSON.parse(fileRaw);
    const out = {
      ...SISREG_META_PADRAO,
      ...parsed,
      origem: 'padrao',
      total: Array.isArray(parsed.procedimentos) ? parsed.procedimentos.length : 0
    };
    _catalogoCache = { data: out, loadedAt: now };
    return out;
  } catch (err) {
    console.warn('[sisreg] Aviso ao ler catálogo padrão:', err.message);
    return {
      ...SISREG_META_PADRAO,
      origem: 'vazio',
      total: 0,
      procedimentos: []
    };
  }
}

const SETORES_DESTINO_DEVOLUCAO = ['Médico', 'Enfermagem', 'Odontologia', 'ACS'];

function inferirSetorDestinoDevolucao(motivo, profissional = '') {
  const m = normSisreg(motivo);
  const p = normSisreg(profissional);
  if (/enderec|cadastr|municip|fora de recife|telefone|cns|residenc|comprovante/.test(m)) {
    return 'ACS';
  }
  if (/odont|dentist|juliana cavalcante|\bcro\b/.test(p)) {
    return 'Odontologia';
  }
  if (/enferm|mariana vaz|jorge marcio|lucelia|\bcoren\b/.test(p)) {
    return 'Enfermagem';
  }
  if (/\bacs\b|agente comunit|ana paula|ana lucia|lenilda|conceicao|joselita|alda|simone|patricia|telma|jeane|joselia|arlinda|nena|rosilene|fatima/.test(p)) {
    return 'ACS';
  }
  return 'Médico';
}

function normalizarSetorDestinoDevolucao(setor, motivo = '', profissional = '') {
  const s = normSisreg(setor);
  if (s === 'acs' || s.includes('agente')) return 'ACS';
  if (s.includes('enferm')) return 'Enfermagem';
  if (s.includes('odont') || s.includes('dent')) return 'Odontologia';
  if (s === 'medico' || s.includes('medic')) return 'Médico';
  return inferirSetorDestinoDevolucao(motivo, profissional);
}

function resolverCanalChatDevolucao(setorDestino) {
  const s = normSisreg(setorDestino);
  if (s === 'acs' || s.includes('agente')) return 'acs';
  if (s.includes('enferm')) return 'enfermagem';
  if (s.includes('odont')) return 'odontologia';
  if (s.includes('medic')) return 'medico';
  return 'geral';
}

function normalizarStatusDevolucao(status) {
  const s = normSisreg(status);
  if (s === 'corrigida') return 'corrigida';
  if (s === 'respondida') return 'respondida';
  return 'pendente';
}

function limparProfissionalDevolucao(prof) {
  const s = limparCampoStr(prof, 120);
  if (!s) return null;
  if (/^todos\b/i.test(normSisreg(s))) return null;
  return s;
}

function pertenceAoProfissionalDevolucao(item, setorAlvo = '', profAlvo = '') {
  if (!item || typeof item !== 'object') return false;
  const setorItem = item.setor_destino || inferirSetorDestinoDevolucao(item.motivo, item.profissional_equipe);
  const sAlvoNorm = normSisreg(setorAlvo);
  if (sAlvoNorm && sAlvoNorm !== 'todos' && normSisreg(setorItem) !== sAlvoNorm) {
    return false;
  }
  const profFiltro = normSisreg(profAlvo);
  if (!profFiltro || profFiltro.startsWith('todos')) {
    return true;
  }
  const profItem = normSisreg(item.profissional_equipe);
  if (!profItem || profItem.startsWith('todos')) {
    return true;
  }
  return profItem === profFiltro || profItem.includes(profFiltro) || profFiltro.includes(profItem);
}

const PRAZO_DEVOLUCAO_DIAS = 3;
const MAX_PRORROGACOES_DEVOLUCAO = 3;
const MAX_ANEXO_DEVOLUCAO_BYTES = 2_100_000;
let _ultimaLimpezaAnexosDev = 0;

function normalizarDetalhesDevolucao(raw) {
  let obj = raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return null;
    try { obj = JSON.parse(s); } catch (_) { return null; }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const out = {
    cns: limparCampoStr(obj.cns, 40),
    dn: limparCampoStr(obj.dn, 20),
    endereco: limparCampoStr(obj.endereco, 320),
    cep: limparCampoStr(obj.cep, 20),
    municipio: limparCampoStr(obj.municipio, 100),
    cid10: limparCampoStr(obj.cid10, 20),
    hipotese: limparCampoStr(obj.hipotese, 260),
    justificativa_original: limparCampoStr(obj.justificativa_original, 1200),
    motivo_central: limparCampoStr(obj.motivo_central, 600)
  };
  const hasAny = Object.values(out).some(Boolean);
  return hasAny ? out : null;
}

function validarAnexoDevolucao(base64, tipo, nome) {
  if (base64 === undefined || base64 === null || String(base64).trim() === '') {
    return { ok: true, anexo_base64: null, anexo_tipo: null, anexo_nome: null, anexo_bytes: 0 };
  }
  const s = String(base64).trim();
  const match = s.match(/^data:(image\/[a-z0-9.+-]+|application\/pdf);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) {
    return { ok: false, error: 'Anexo inválido. Envie apenas foto (JPG/PNG/WebP) ou PDF.' };
  }
  if (s.length > MAX_ANEXO_DEVOLUCAO_BYTES) {
    return { ok: false, error: 'Anexo excede o limite máximo permitido (~1,5 MB). Comprima a foto ou use PDF menor.' };
  }
  const mime = match[1].toLowerCase();
  const tipoFinal = tipo === 'pdf' || mime === 'application/pdf' ? 'pdf' : 'image';
  const payload = match[2].replace(/\s+/g, '');
  const approxBytes = Math.round((payload.length * 3) / 4);
  return {
    ok: true,
    anexo_base64: s,
    anexo_tipo: tipoFinal,
    anexo_nome: limparCampoStr(nome, 140) || (tipoFinal === 'pdf' ? 'documento-sisreg.pdf' : 'ficha-sisreg.jpg'),
    anexo_bytes: approxBytes
  };
}

function calcularStatusPrazoDevolucao(prazoEm, status, now = new Date()) {
  if (normSisreg(status) === 'corrigida') {
    return { vencido: false, urgente: false, horasRestantes: 0, diasRestantes: 0, label: 'Corrigida' };
  }
  if (!prazoEm) {
    return { vencido: false, urgente: false, horasRestantes: 72, diasRestantes: PRAZO_DEVOLUCAO_DIAS, label: `${PRAZO_DEVOLUCAO_DIAS}d restantes` };
  }
  const dtPrazo = new Date(prazoEm);
  if (Number.isNaN(dtPrazo.getTime())) {
    return { vencido: false, urgente: false, horasRestantes: 72, diasRestantes: PRAZO_DEVOLUCAO_DIAS, label: `${PRAZO_DEVOLUCAO_DIAS}d restantes` };
  }
  const diffMs = dtPrazo.getTime() - now.getTime();
  if (diffMs <= 0) {
    return { vencido: true, urgente: true, horasRestantes: 0, diasRestantes: 0, label: 'Prazo vencido' };
  }
  const horasRestantes = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60)));
  if (horasRestantes < 24) {
    return { vencido: false, urgente: true, horasRestantes, diasRestantes: 0, label: `Vence em ${horasRestantes}h` };
  }
  const diasRestantes = Math.ceil(horasRestantes / 24);
  return { vencido: false, urgente: diasRestantes <= 1, horasRestantes, diasRestantes, label: `${diasRestantes}d restantes` };
}

async function limparAnexosDevolucoesExpirados(db) {
  if (!db) return 0;
  const r = await db.query(
    `UPDATE regulacao_devolucoes
     SET anexo_base64 = NULL, anexo_tipo = NULL, anexo_nome = NULL, anexo_bytes = 0
     WHERE anexo_base64 IS NOT NULL
       AND (status = 'corrigida' OR (prazo_em IS NOT NULL AND prazo_em < CURRENT_TIMESTAMP))`
  );
  return Number(r?.rowCount || 0);
}

async function limparAnexosDevolucoesExpiradosThrottled(db) {
  const now = Date.now();
  if ((now - _ultimaLimpezaAnexosDev) < 10 * 60 * 1000) return 0;
  _ultimaLimpezaAnexosDev = now;
  try {
    return await limparAnexosDevolucoesExpirados(db);
  } catch (_) {
    return 0;
  }
}

function formatarMensagemChatDevolucao(item, tipo = 'alerta') {
  const it = item && typeof item === 'object' ? item : {};
  const setor = it.setor_destino || inferirSetorDestinoDevolucao(it.motivo, it.profissional_equipe);
  const prof = limparProfissionalDevolucao(it.profissional_equipe);
  const prot = it.codigo_solicitacao ? ` (Prot: ${it.codigo_solicitacao})` : '';
  const proc = it.procedimento ? ` | Proc: ${it.procedimento}` : '';
  if (tipo === 'solucao') {
    const autor = limparCampoStr(it.solucao_autor, 120) || 'Profissional';
    const sol = limparCampoStr(it.solucao, 1000) || '';
    return `✅ SOLUÇÃO DEVOLUÇÃO SISREG — Paciente: ${it.paciente_nome || 'Paciente'}${prot}${proc} | Respondido por: ${autor} (${setor}) | Solução: ${sol}\n👉 Pronto para a Regulação corrigir no SISREG.`;
  }
  const obs = it.observacao ? ` | Detalhe: ${it.observacao}` : '';
  const anexoTag = (it.tem_anexo || it.anexo_base64) ? ' | 📎 Com documento anexo' : '';
  const destLabel = prof ? `🎯 Destinatário: ${prof}` : `👥 Destinatário: Todos (${setor})`;
  return `↩️ DEVOLUÇÃO SISREG [Setor: ${setor}${prof ? ' · ' + prof : ''}] — ${destLabel} | Paciente: ${it.paciente_nome || 'Paciente'}${prot}${proc} | Motivo: ${it.motivo || 'Pendência'}${obs}${anexoTag} | ⏳ Prazo: ${PRAZO_DEVOLUCAO_DIAS} dias\n👉 Responda pelo atalho "↩️ Devoluções SISREG" informando a correção/solução.`;
}

async function garantirTabelaRegulacao(db) {
  if (_tabelaDevolucoesCriada || !db) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS regulacao_devolucoes (
      id SERIAL PRIMARY KEY,
      paciente_nome TEXT NOT NULL,
      codigo_solicitacao TEXT,
      procedimento TEXT,
      motivo TEXT NOT NULL,
      telefone TEXT,
      profissional_equipe TEXT,
      setor_destino TEXT DEFAULT 'Médico',
      observacao TEXT,
      detalhes_json TEXT,
      anexo_base64 TEXT,
      anexo_tipo TEXT,
      anexo_nome TEXT,
      anexo_bytes INTEGER DEFAULT 0,
      prazo_em TIMESTAMPTZ,
      prorrogacoes INTEGER DEFAULT 0,
      solucao TEXT,
      solucao_autor TEXT,
      solucao_em TIMESTAMPTZ,
      status TEXT DEFAULT 'pendente',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      resolvida_em TIMESTAMPTZ
    )
  `);
  await db.query(`ALTER TABLE regulacao_devolucoes ADD COLUMN IF NOT EXISTS setor_destino TEXT DEFAULT 'Médico'`);
  await db.query(`ALTER TABLE regulacao_devolucoes ADD COLUMN IF NOT EXISTS detalhes_json TEXT`);
  await db.query(`ALTER TABLE regulacao_devolucoes ADD COLUMN IF NOT EXISTS anexo_base64 TEXT`);
  await db.query(`ALTER TABLE regulacao_devolucoes ADD COLUMN IF NOT EXISTS anexo_tipo TEXT`);
  await db.query(`ALTER TABLE regulacao_devolucoes ADD COLUMN IF NOT EXISTS anexo_nome TEXT`);
  await db.query(`ALTER TABLE regulacao_devolucoes ADD COLUMN IF NOT EXISTS anexo_bytes INTEGER DEFAULT 0`);
  await db.query(`ALTER TABLE regulacao_devolucoes ADD COLUMN IF NOT EXISTS prazo_em TIMESTAMPTZ`);
  await db.query(`ALTER TABLE regulacao_devolucoes ADD COLUMN IF NOT EXISTS prorrogacoes INTEGER DEFAULT 0`);
  await db.query(`ALTER TABLE regulacao_devolucoes ADD COLUMN IF NOT EXISTS solucao TEXT`);
  await db.query(`ALTER TABLE regulacao_devolucoes ADD COLUMN IF NOT EXISTS solucao_autor TEXT`);
  await db.query(`ALTER TABLE regulacao_devolucoes ADD COLUMN IF NOT EXISTS solucao_em TIMESTAMPTZ`);
  _tabelaDevolucoesCriada = true;
}

function limparCampoStr(v, maxLen = 300) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s || /^null$/i.test(s) || /^n[ãa]o informado$/i.test(s)) return null;
  return s.slice(0, maxLen);
}

function parsearBlocosTextoObservacoesSisreg(textoRaw) {
  const texto = String(textoRaw || '').trim();
  if (!texto) return [];

  const marcadorRe = /(?:^|[\n\r])\s*(?:[-•*]\s*)?((?:operador\s+|unidade\s+|profissional\s+|medico\s+|médico\s+)?solicitante|(?:medico\s+|médico\s+)?regulador(?:\(a\))?|central\s+de\s+regulac[aã]o|central\s+regulador[a]?)\s*:/gi;
  const matches = [];
  let m;
  while ((m = marcadorRe.exec(texto)) !== null) {
    const labelRaw = m[1];
    const startMatch = m.index;
    const afterColon = m.index + m[0].length;
    matches.push({ labelRaw, startMatch, afterColon });
  }
  if (matches.length === 0) return [];

  const entradas = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const end = i + 1 < matches.length ? matches[i + 1].startMatch : texto.length;
    const body = texto.slice(cur.afterColon, end).trim();
    const labelNorm = normSisreg(cur.labelRaw);
    const papel = labelNorm.includes('regulador') ? 'regulador' : 'solicitante';

    let data = null;
    let autor = null;
    let txtLimpo = body;

    // Extrai "Data: DD/MM/AAAA [HH:MM]" em qualquer posição dentro do bloco
    const dataTagRe = /\bdata(?:\s+da\s+(?:analise|análise|devolucao|devolução|observacao|observação|solicitacao|solicitação))?\s*:\s*(\d{2}\/\d{2}\/\d{4}(?:\s+(?:às\s+|as\s+)?\d{2}:\d{2}(?::\d{2})?)?)/i;
    const dm = body.match(dataTagRe);
    if (dm) {
      data = dm[1].trim();
      const idxData = dm.index;
      const antes = body.slice(0, idxData).replace(/^[\s\-–:|]+|[\s\-–:|]+$/g, '').trim();
      const depois = body.slice(idxData + dm[0].length).replace(/^[\s\-–:|]+|[\s\-–:|]+$/g, '').trim();

      if (antes && depois) {
        // Ex: "DR JOAO SILVA | Data: 14/11/2026 | FALTA DESCREVER..."
        const antesPareceAutor = antes.length <= 65 && !/[.;!?]/.test(antes) && antes.split(/\s+/).length <= 6;
        if (antesPareceAutor) {
          autor = antes;
          txtLimpo = depois;
        } else {
          txtLimpo = `${antes} ${depois}`.trim();
        }
      } else {
        txtLimpo = antes || depois || '';
      }
    } else {
      const bareDate = body.match(/\b(\d{2}\/\d{2}\/\d{4})\b/);
      if (bareDate) data = bareDate[1];
    }

    txtLimpo = txtLimpo
      .replace(/^(?:observa[çc][ãa]o|observa[çc][õo]es|justificativa|parecer|motivo)\s*:\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (txtLimpo || data || autor) {
      entradas.push({
        papel,
        autor: limparCampoStr(autor, 120),
        data: limparCampoStr(data, 32),
        texto: limparCampoStr(txtLimpo, 2000) || ''
      });
    }
  }
  return entradas;
}

function analisarHistoricoObservacoesSisreg(input = {}) {
  const p = input && typeof input === 'object' ? input : { observacoes_original: String(input || '') };
  const statusRaw = normSisreg(p.status_documento_sisreg || p.status || '').toUpperCase();
  const obsOrig = String(p.observacoes_original || '').trim();
  const obsRev = String(p.observacoes_revisada || '').trim();
  const textoCombinado = [obsOrig, obsRev, String(p.parecer_regulador || '')].filter(Boolean).join('\n');
  const textoNorm = normSisreg(textoCombinado);

  const histRaw = Array.isArray(p.historico_observacoes) ? p.historico_observacoes : [];
  let historico = histRaw
    .map(item => {
      if (!item || typeof item !== 'object') return null;
      const pNorm = normSisreg(item.papel || item.tipo || item.ator || '');
      const papel = pNorm.includes('regulador') ? 'regulador' : (pNorm.includes('solicit') ? 'solicitante' : 'outro');
      const texto = limparCampoStr(item.texto || item.observacao || item.descricao, 2000) || '';
      const autor = limparCampoStr(item.autor || item.nome, 120);
      const data = limparCampoStr(item.data, 32);
      if (!texto && !data && !autor) return null;
      return { papel, autor, data, texto };
    })
    .filter(Boolean);

  // Fallback/enriquecimento determinístico se o texto original trouxe marcadores "Solicitante:" / "Regulador:" / "Data:"
  const parsedBlocos = parsearBlocosTextoObservacoesSisreg(obsOrig || obsRev);
  if (parsedBlocos.length > 0 && (historico.length === 0 || (parsedBlocos.some(b => b.papel === 'regulador') && !historico.some(h => h.papel === 'regulador')))) {
    historico = parsedBlocos;
  }

  let obsSolicitante = limparCampoStr(p.observacao_solicitante, 2500);
  if (!obsSolicitante) {
    const blocosSol = historico.filter(h => h.papel === 'solicitante' && h.texto);
    if (blocosSol.length > 0) {
      obsSolicitante = blocosSol.map(b => b.texto).join('\n');
    }
  }

  let parecerRegulador = limparCampoStr(p.parecer_regulador, 2000);
  let dataDevolucao = limparCampoStr(p.data_devolucao_regulador, 32);
  let nomeRegulador = limparCampoStr(p.nome_regulador, 120);

  const blocosReg = historico.filter(h => h.papel === 'regulador');
  if (blocosReg.length > 0) {
    const ultimoReg = blocosReg[blocosReg.length - 1];
    if (!parecerRegulador && ultimoReg.texto) parecerRegulador = ultimoReg.texto;
    if (!dataDevolucao && ultimoReg.data) dataDevolucao = ultimoReg.data;
    if (!nomeRegulador && ultimoReg.autor) nomeRegulador = ultimoReg.autor;
  }

  const temStatusDevolvido = /devolvid|pendencia|pendente para unidade|aguardando correcao|aguardando solicitante/.test(normSisreg(statusRaw));
  const temStatusAutorizado = /\bautorizad[oa]\b|\bagendad[oa]\b|\bconfirmad[oa]\b/.test(normSisreg(statusRaw));
  const temTextoDevolucao = /\bdevolvid[oa]\b|\bmotivo da devolucao\b|\bdevolucao da central\b/.test(textoNorm);
  const parecerNorm = normSisreg(parecerRegulador || '');
  const parecerEhSoAutorizacao = Boolean(parecerNorm && /^(autorizad[oa]|agendad[oa]|aprovad[oa]|deferid[oa])\.?$/.test(parecerNorm));

  const documentoDevolvido = Boolean(
    p.documento_devolvido === true ||
    temStatusDevolvido ||
    temTextoDevolucao ||
    (parecerRegulador && !parecerEhSoAutorizacao && !temStatusAutorizado)
  );

  let statusDocumento = statusRaw ? statusRaw.slice(0, 40) : null;
  if (!statusDocumento && documentoDevolvido) {
    statusDocumento = 'DEVOLVIDO';
  }

  // Se não havia entrada de regulador em `historico`, mas veio `parecer_regulador`, garante entrada no histórico
  if (parecerRegulador && !historico.some(h => h.papel === 'regulador')) {
    historico.push({
      papel: 'regulador',
      autor: nomeRegulador,
      data: dataDevolucao,
      texto: parecerRegulador
    });
  }
  if (obsSolicitante && !historico.some(h => h.papel === 'solicitante')) {
    historico.unshift({
      papel: 'solicitante',
      autor: limparCampoStr(p.medico_solicitante, 120),
      data: limparCampoStr(p.data_solicitacao, 32),
      texto: obsSolicitante
    });
  }

  return {
    documento_devolvido: documentoDevolvido,
    status_documento_sisreg: statusDocumento,
    historico_observacoes: historico,
    observacao_solicitante: obsSolicitante,
    parecer_regulador: parecerRegulador,
    data_devolucao_regulador: dataDevolucao,
    nome_regulador: nomeRegulador
  };
}

function normalizarResultadoOcrSisreg(parsed) {
  const p = parsed && typeof parsed === 'object' ? parsed : {};
  const procs = Array.isArray(p.procedimentos_pedidos)
    ? p.procedimentos_pedidos.map(x => limparCampoStr(x, 180)).filter(Boolean)
    : [];
  const esp = limparCampoStr(p.especialidade_ou_exame, 180);
  if (esp && !procs.some(x => normSisreg(x) === normSisreg(esp))) {
    procs.unshift(esp);
  }
  const sexoRaw = normSisreg(p.paciente_sexo).toUpperCase();
  const paciente_sexo = sexoRaw.startsWith('M') ? 'M' : sexoRaw.startsWith('F') ? 'F' : null;
  const alerts = Array.isArray(p.alertas_digitacao)
    ? p.alertas_digitacao.map(x => limparCampoStr(x, 220)).filter(Boolean)
    : [];
  const { paciente_cns, paciente_cpf } = separarCnsECpf(p.paciente_cns, p.paciente_cpf);
  const endDecomp = decomporEnderecoPaciente({
    endereco: p.paciente_endereco,
    numero: p.paciente_numero,
    complemento: p.paciente_complemento,
    bairro: p.paciente_bairro,
    cep: p.paciente_cep,
    municipio: p.paciente_municipio,
    uf: p.paciente_uf
  });
  const telFmt = formatarTelefoneBR(p.paciente_telefone) || limparCampoStr(p.paciente_telefone, 50);
  const histInfo = analisarHistoricoObservacoesSisreg(p);
  const obsRevisadaRaw = limparCampoStr(p.observacoes_revisada, 3000);
  // Se observacoes_revisada veio vazia ou misturou o parecer do Regulador, prioriza a observação limpa do Solicitante
  const obsRevisadaLimpa = (obsRevisadaRaw && (!histInfo.parecer_regulador || !normSisreg(obsRevisadaRaw).includes('regulador:')))
    ? obsRevisadaRaw
    : (histInfo.observacao_solicitante || obsRevisadaRaw || limparCampoStr(p.observacoes_original, 3000));

  return {
    tipo_arquivo: limparCampoStr(p.tipo_arquivo, 40) || 'ficha_ambulatorial',
    codigo_solicitacao: limparCampoStr(p.codigo_solicitacao, 60),
    status_documento_sisreg: histInfo.status_documento_sisreg,
    documento_devolvido: histInfo.documento_devolvido,
    historico_observacoes: histInfo.historico_observacoes,
    observacao_solicitante: histInfo.observacao_solicitante,
    parecer_regulador: histInfo.parecer_regulador,
    data_devolucao_regulador: histInfo.data_devolucao_regulador,
    nome_regulador: histInfo.nome_regulador,
    medicamentos: limparCampoStr(p.medicamentos || p.medicamento, 1200),
    itens_posologia: Array.isArray(p.itens_posologia) ? p.itens_posologia : [],
    data_emissao_receita: limparCampoStr(p.data_emissao_receita || p.data_emissao, 20),
    paciente_nome: limparCampoStr(p.paciente_nome, 180),
    paciente_cns: paciente_cns || null,
    paciente_cpf: paciente_cpf || null,
    paciente_rg: limparCampoStr(p.paciente_rg, 30),
    paciente_dn: limparCampoStr(p.paciente_dn, 20),
    paciente_sexo,
    paciente_mae: limparCampoStr(p.paciente_mae, 180),
    paciente_telefone: telFmt,
    paciente_endereco: endDecomp.logradouro || limparCampoStr(p.paciente_endereco, 300),
    paciente_numero: endDecomp.numero,
    paciente_complemento: endDecomp.complemento,
    paciente_bairro: endDecomp.bairro,
    paciente_cep: endDecomp.cep || formatarCepBR(p.paciente_cep),
    paciente_municipio: endDecomp.municipio,
    paciente_uf: endDecomp.uf,
    tipo_vaga: ['primeira_vez', 'retorno'].includes(p.tipo_vaga) ? p.tipo_vaga : null,
    risco: ['azul', 'verde', 'amarelo', 'vermelho'].includes(normSisreg(p.risco)) ? normSisreg(p.risco) : null,
    especialidade_ou_exame: esp || procs[0] || null,
    procedimentos_pedidos: procs,
    hipotese_diagnostica: limparCampoStr(p.hipotese_diagnostica, 300),
    cid10: limparCampoStr(p.cid10, 20),
    medico_solicitante: limparCampoStr(p.medico_solicitante, 160),
    crm_conselho: limparCampoStr(p.crm_conselho, 60),
    data_solicitacao: limparCampoStr(p.data_solicitacao, 20),
    tem_assinatura_carimbo: typeof p.tem_assinatura_carimbo === 'boolean' ? p.tem_assinatura_carimbo : null,
    observacoes_original: limparCampoStr(p.observacoes_original, 3000),
    observacoes_revisada: obsRevisadaLimpa,
    alertas_digitacao: alerts,
    confianca: Number.isFinite(Number(p.confianca)) ? Math.round(Number(p.confianca)) : 75
  };
}

function executarValidacoesFichaSisreg(dados, catalogo) {
  const idade = calcularIdadeDataBR(dados.paciente_dn);
  const cns = validarCNS(dados.paciente_cns);
  const telefone = validarTelefoneBR(dados.paciente_telefone);
  const endereco = verificarEnderecoRecife({
    municipio: dados.paciente_municipio,
    uf: dados.paciente_uf,
    cep: dados.paciente_cep,
    endereco: dados.paciente_endereco,
    bairro: dados.paciente_bairro
  });

  const termos = dados.procedimentos_pedidos?.length
    ? dados.procedimentos_pedidos
    : (dados.especialidade_ou_exame ? [dados.especialidade_ou_exame] : []);

  const sugestoes_procedimentos = termos.map(termo => ({
    termo,
    resultados: buscarProcedimentosSisreg(catalogo?.procedimentos || [], termo, {
      idade,
      tipoVaga: dados.tipo_vaga,
      limite: 6
    })
  }));

  const pendencias = [];
  if (dados.documento_devolvido) {
    pendencias.push(
      `Documento DEVOLVIDO pelo Regulador${dados.data_devolucao_regulador ? ` em ${dados.data_devolucao_regulador}` : ''}`
    );
  }
  if (!dados.paciente_cns) pendencias.push('CNS não identificado');
  else if (cns.valido === false) pendencias.push(cns.motivo);
  if (!telefone.valido) pendencias.push('Telefone ausente ou incompleto');
  if (endereco.status === 'fora_recife') pendencias.push('Endereço/CEP fora de Recife');
  if (!dados.cid10) pendencias.push('CID-10 não identificado');
  if (!dados.observacoes_revisada) pendencias.push('Condições clínicas/Observação vazia');
  else if (String(dados.observacoes_revisada).includes('[CONFERIR')) {
    pendencias.push('Há trecho manuscrito sinalizado para conferência na observação');
  }
  if (dados.tem_assinatura_carimbo === false) pendencias.push('Verificar assinatura e carimbo na ficha');

  return {
    validacoes: {
      idade,
      cns,
      telefone,
      endereco,
      pendencias
    },
    sugestoes_procedimentos
  };
}

function setupSisreg(app, pool, isValidAdminPass) {
  // Retornar catálogo SISREG ativo (DB personalizado ou JSON padrão DS5)
  app.get('/api/sisreg/catalogo', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    try {
      const cat = await carregarCatalogoSisregAtivo(pool);
      res.json(cat);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Importar/atualizar tabela SISREG a partir de arquivo HTML oficial (Admin)
  app.post('/api/sisreg/catalogo/importar', async (req, res) => {
    try {
      const senha = req.body?.senha || req.headers['x-admin-password'];
      if (typeof isValidAdminPass === 'function' && !isValidAdminPass(senha)) {
        return res.status(401).json({ error: 'Senha de administrador inválida.' });
      }
      const html = req.body?.html;
      if (!html || typeof html !== 'string' || html.length < 200) {
        return res.status(400).json({ error: 'Arquivo HTML do catálogo SISREG inválido ou vazio.' });
      }
      const cat = parsearHtmlCatalogoSisreg(html);
      if (cat.total < 10) {
        return res.status(400).json({
          error: `Poucos procedimentos encontrados (${cat.total}). Verifique se o arquivo é a tabela HTML do SISREG.`
        });
      }
      await pool.query(
        `INSERT INTO configuracoes (chave, valor)
         VALUES ('sisreg_catalogo_json', $1)
         ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
        [JSON.stringify(cat)]
      );
      _catalogoCache = { data: { ...cat, origem: 'personalizado' }, loadedAt: Date.now() };
      res.json({
        ok: true,
        total: cat.total,
        versao: cat.versao,
        atualizado_em: cat.atualizado_em
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Restaurar catálogo padrão embutido
  app.delete('/api/sisreg/catalogo/importar', async (req, res) => {
    try {
      const senha = req.body?.senha || req.headers['x-admin-password'];
      if (typeof isValidAdminPass === 'function' && !isValidAdminPass(senha)) {
        return res.status(401).json({ error: 'Senha de administrador inválida.' });
      }
      await pool.query(`DELETE FROM configuracoes WHERE chave = 'sisreg_catalogo_json'`);
      _catalogoCache = { data: null, loadedAt: 0 };
      const cat = await carregarCatalogoSisregAtivo(pool);
      res.json({ ok: true, total: cat.total, origem: cat.origem });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Analisar foto da Ficha Ambulatorial ou PDF pronto do SISREG com Gemini Vision
  app.post('/api/sisreg/analisar-ficha', async (req, res) => {
    const rl = checkRateLimit('ocr_ai', getClientIp(req), 60, 60 * 1000);
    if (!rl.allowed) {
      return res.status(429).json({
        error: `Limite momentâneo de análises atingido. Aguarde ${rl.retryAfterSec}s e tente novamente.`
      });
    }
    const apiKey = (process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '').trim();
    const groqApiKey = (process.env.GROQ_API_KEY || '').trim();
    const raw = req.body?.arquivo_base64 || req.body?.imagem_base64;
    if (!raw || typeof raw !== 'string') {
      return res.status(400).json({ error: 'Arquivo (imagem ou PDF) é obrigatório.' });
    }
    if (raw.length > 4_400_000) {
      return res.status(400).json({ error: 'Arquivo muito grande. Envie foto comprimida ou PDF até 3 MB.' });
    }
    const mimeMatch = raw.match(/^data:([^;]+);base64,/i);
    const mimeType = mimeMatch ? mimeMatch[1].toLowerCase() : 'image/jpeg';
    if (!mimeType.startsWith('image/') && mimeType !== 'application/pdf') {
      return res.status(400).json({ error: 'Formato não suportado. Envie uma foto (JPG/PNG) ou arquivo PDF.' });
    }
    if (!apiKey && !(groqApiKey && mimeType.startsWith('image/'))) {
      return res.json({
        ok: false,
        fallback_manual: true,
        error: 'Chave GEMINI_API_KEY não configurada no servidor. Você ainda pode consultar o catálogo e preencher manualmente.'
      });
    }
    const base64Data = raw.includes(',') ? raw.split(',')[1] : raw;
    const catalogo = await carregarCatalogoSisregAtivo(pool);

    const ocrRes = await executarOcrGeminiJson({
      apiKey,
      groqApiKey,
      prompt: PROMPT_OCR_FICHA_SISREG,
      mimeType,
      base64Data,
      maxOutputTokens: 2200,
      cacheNamespace: 'sisreg'
    });

    if (ocrRes.ok && ocrRes.parsed) {
      const dados = normalizarResultadoOcrSisreg(ocrRes.parsed);
      const { validacoes, sugestoes_procedimentos } = executarValidacoesFichaSisreg(dados, catalogo);
      const ehReceita = /^receita/i.test(dados.tipo_arquivo || '') ||
        (Boolean(dados.medicamentos) && !dados.especialidade_ou_exame && !dados.codigo_solicitacao);
      let alerta_receita = null;
      if (ehReceita) {
        const clfReceita = classificarReceita(
          dados.tipo_arquivo,
          dados.medicamentos || '',
          dados.data_emissao_receita || dados.data_solicitacao || '',
          new Date(),
          {
            itens_posologia: dados.itens_posologia,
            texto_posologia: dados.observacoes_original || dados.medicamentos || '',
            cid10: dados.cid10 || ''
          }
        );
        alerta_receita = {
          eh_receita: true,
          ...clfReceita,
          medicamentos: dados.medicamentos || null
        };
      }

      return res.json({
        ok: true,
        provider: ocrRes.provider || 'gemini',
        model: ocrRes.model,
        cached: Boolean(ocrRes.fromCache),
        dados,
        validacoes,
        sugestoes_procedimentos,
        alerta_receita
      });
    }

    return res.json({
      ok: false,
      fallback_manual: true,
      error: `${ocrRes.error || 'Não foi possível analisar o documento automaticamente.'} Você ainda pode visualizar a imagem ao lado e pesquisar o procedimento normalmente.`
    });
  });

  const COLS_DEVOLUCAO_LISTA = `
    id, paciente_nome, codigo_solicitacao, procedimento, motivo, telefone,
    profissional_equipe, setor_destino, observacao, detalhes_json,
    solucao, solucao_autor, solucao_em, status, created_at, resolvida_em,
    prazo_em, COALESCE(prorrogacoes, 0) AS prorrogacoes,
    anexo_tipo, anexo_nome, COALESCE(anexo_bytes, 0) AS anexo_bytes,
    (anexo_base64 IS NOT NULL) AS tem_anexo
  `;

  // Listar devoluções (sem anexo_base64 para manter listagem rápida e leve)
  app.get('/api/sisreg/devolucoes', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    try {
      await garantirTabelaRegulacao(pool);
      await limparAnexosDevolucoesExpiradosThrottled(pool);
      const status = String(req.query?.status || '').trim().toLowerCase();
      const setorDestino = String(req.query?.setor_destino || '').trim();
      const profissional = String(req.query?.profissional || '').trim();
      const clauses = [];
      const params = [];
      let idx = 1;

      if (status === 'abertas') {
        clauses.push(`status IN ('pendente', 'respondida')`);
      } else if (status && status !== 'todas') {
        clauses.push(`status = $${idx++}`);
        params.push(normalizarStatusDevolucao(status));
      }
      if (setorDestino && setorDestino.toLowerCase() !== 'todos') {
        clauses.push(`COALESCE(NULLIF(setor_destino, ''), 'Médico') = $${idx++}`);
        params.push(normalizarSetorDestinoDevolucao(setorDestino));
      }
      if (profissional && !/^todos\b/i.test(normSisreg(profissional))) {
        clauses.push(`(profissional_equipe IS NULL OR TRIM(profissional_equipe) = '' OR LOWER(TRIM(profissional_equipe)) LIKE 'todos%' OR profissional_equipe ILIKE $${idx++})`);
        params.push(`%${profissional}%`);
      }

      const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      const r = await pool.query(
        `SELECT ${COLS_DEVOLUCAO_LISTA} FROM regulacao_devolucoes ${where}
         ORDER BY CASE status WHEN 'pendente' THEN 0 WHEN 'respondida' THEN 1 ELSE 2 END, created_at DESC
         LIMIT 300`,
        params
      );
      res.json(r.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Limpar anexos vencidos / já corrigidos (ou apagar todos por Admin)
  app.post('/api/sisreg/devolucoes/limpar-anexos', async (req, res) => {
    try {
      await garantirTabelaRegulacao(pool);
      if (req.body?.limpar_todos === true) {
        const senha = req.body?.senha || req.headers['x-admin-password'];
        if (typeof isValidAdminPass === 'function' && !isValidAdminPass(senha)) {
          return res.status(401).json({ error: 'Senha de administrador inválida para limpar todos os anexos.' });
        }
        const rAll = await pool.query(
          `UPDATE regulacao_devolucoes
           SET anexo_base64 = NULL, anexo_tipo = NULL, anexo_nome = NULL, anexo_bytes = 0
           WHERE anexo_base64 IS NOT NULL`
        );
        return res.json({ ok: true, removidos: Number(rAll?.rowCount || 0) });
      }
      const removidos = await limparAnexosDevolucoesExpirados(pool);
      res.json({ ok: true, removidos });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Baixar documento anexo sob demanda (lazy-load para conferência)
  app.get('/api/sisreg/devolucoes/:id/anexo', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    try {
      await garantirTabelaRegulacao(pool);
      await limparAnexosDevolucoesExpiradosThrottled(pool);
      const id = parseInt(req.params.id, 10);
      const r = await pool.query(
        `SELECT id, status, prazo_em, anexo_tipo, anexo_nome, COALESCE(anexo_bytes, 0) AS anexo_bytes,
                anexo_base64, (anexo_base64 IS NOT NULL) AS tem_anexo
         FROM regulacao_devolucoes WHERE id = $1`,
        [id]
      );
      if (r.rows.length === 0) {
        return res.status(404).json({ error: 'Registro de devolução não encontrado.' });
      }
      res.json(r.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/sisreg/devolucoes', async (req, res) => {
    try {
      await garantirTabelaRegulacao(pool);
      const nome = limparCampoStr(req.body?.paciente_nome, 180);
      const motivo = limparCampoStr(req.body?.motivo, 120);
      if (!nome || !motivo) {
        return res.status(400).json({ error: 'Nome do paciente e motivo da devolução são obrigatórios.' });
      }
      const anexoVal = validarAnexoDevolucao(req.body?.anexo_base64, req.body?.anexo_tipo, req.body?.anexo_nome);
      if (!anexoVal.ok) {
        return res.status(400).json({ error: anexoVal.error });
      }
      const detalhesObj = normalizarDetalhesDevolucao(req.body?.detalhes || req.body?.detalhes_json);
      const detalhesJson = detalhesObj ? JSON.stringify(detalhesObj) : null;
      const profissional = limparProfissionalDevolucao(req.body?.profissional_equipe);
      const setorDestino = normalizarSetorDestinoDevolucao(req.body?.setor_destino, motivo, profissional || '');
      const r = await pool.query(
        `INSERT INTO regulacao_devolucoes (
           paciente_nome, codigo_solicitacao, procedimento, motivo, telefone,
           profissional_equipe, setor_destino, observacao, detalhes_json,
           anexo_base64, anexo_tipo, anexo_nome, anexo_bytes, prazo_em, prorrogacoes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP + INTERVAL '3 days', 0)
         RETURNING ${COLS_DEVOLUCAO_LISTA}`,
        [
          nome,
          limparCampoStr(req.body?.codigo_solicitacao, 60),
          limparCampoStr(req.body?.procedimento, 220),
          motivo,
          limparCampoStr(req.body?.telefone, 50),
          profissional,
          setorDestino,
          limparCampoStr(req.body?.observacao, 1000),
          detalhesJson,
          anexoVal.anexo_base64,
          anexoVal.anexo_tipo,
          anexoVal.anexo_nome,
          anexoVal.anexo_bytes
        ]
      );
      const saved = r.rows[0];
      let chatNotificado = false;
      const canalChat = resolverCanalChatDevolucao(setorDestino);
      if (req.body?.enviar_chat !== false) {
        try {
          const textoChat = formatarMensagemChatDevolucao(saved, 'alerta');
          await pool.query(
            `INSERT INTO chat_channels (canal, autor, texto, urgente) VALUES ($1, $2, $3, $4)`,
            [canalChat, '📋 Regulação', textoChat, true]
          );
          chatNotificado = true;
        } catch (_) {}
      }
      res.status(201).json({ ...saved, chat_notificado: chatNotificado, canal_chat: canalChat });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Adiar prazo em +3 dias (máximo 3 prorrogações)
  app.post('/api/sisreg/devolucoes/:id/adiar', async (req, res) => {
    try {
      await garantirTabelaRegulacao(pool);
      const id = parseInt(req.params.id, 10);
      const check = await pool.query('SELECT id, status, COALESCE(prorrogacoes, 0) AS prorrogacoes FROM regulacao_devolucoes WHERE id = $1', [id]);
      if (check.rows.length === 0) {
        return res.status(404).json({ error: 'Registro de devolução não encontrado.' });
      }
      const row = check.rows[0];
      if (row.status === 'corrigida') {
        return res.status(400).json({ error: 'Esta devolução já foi marcada como corrigida.' });
      }
      if (Number(row.prorrogacoes || 0) >= MAX_PRORROGACOES_DEVOLUCAO) {
        return res.status(400).json({ error: `Limite máximo de ${MAX_PRORROGACOES_DEVOLUCAO} prorrogações (+3 dias cada) atingido.` });
      }
      const r = await pool.query(
        `UPDATE regulacao_devolucoes
         SET prazo_em = GREATEST(CURRENT_TIMESTAMP, COALESCE(prazo_em, CURRENT_TIMESTAMP)) + INTERVAL '3 days',
             prorrogacoes = COALESCE(prorrogacoes, 0) + 1
         WHERE id = $1
         RETURNING ${COLS_DEVOLUCAO_LISTA}`,
        [id]
      );
      res.json(r.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/sisreg/devolucoes/:id', async (req, res) => {
    try {
      await garantirTabelaRegulacao(pool);
      const id = parseInt(req.params.id, 10);
      const solucao = limparCampoStr(req.body?.solucao, 1000);
      const solucaoAutor = limparCampoStr(req.body?.solucao_autor, 120);
      const setorReq = req.body?.setor_destino ? normalizarSetorDestinoDevolucao(req.body.setor_destino) : null;
      const temSolucaoNova = Boolean(solucao);
      const statusInput = req.body?.status ? normalizarStatusDevolucao(req.body.status) : null;
      const statusFinal = statusInput === 'corrigida'
        ? 'corrigida'
        : (temSolucaoNova ? 'respondida' : statusInput);

      let detalhesJson = null;
      if (req.body?.detalhes || req.body?.detalhes_json) {
        const dObj = normalizarDetalhesDevolucao(req.body?.detalhes || req.body?.detalhes_json);
        if (dObj) detalhesJson = JSON.stringify(dObj);
      }

      let anexoBase64Arg = null, anexoTipoArg = null, anexoNomeArg = null, anexoBytesArg = null;
      if (req.body?.anexo_base64 && statusFinal !== 'corrigida') {
        const anexoVal = validarAnexoDevolucao(req.body.anexo_base64, req.body?.anexo_tipo, req.body?.anexo_nome);
        if (!anexoVal.ok) {
          return res.status(400).json({ error: anexoVal.error });
        }
        anexoBase64Arg = anexoVal.anexo_base64;
        anexoTipoArg = anexoVal.anexo_tipo;
        anexoNomeArg = anexoVal.anexo_nome;
        anexoBytesArg = anexoVal.anexo_bytes;
      }

      const prevRes = await pool.query('SELECT status, solucao FROM regulacao_devolucoes WHERE id = $1', [id]);
      if (prevRes.rows.length === 0) {
        return res.status(404).json({ error: 'Registro de devolução não encontrado.' });
      }
      const prevRow = prevRes.rows[0];
      const jaRespondidaMesmaSolucao = Boolean(
        temSolucaoNova && prevRow.solucao && normSisreg(prevRow.solucao) === normSisreg(solucao)
      );
      const jaCorrigida = prevRow.status === 'corrigida' && statusFinal !== 'pendente';

      const r = await pool.query(
        `UPDATE regulacao_devolucoes
         SET status = COALESCE($2, status),
             observacao = COALESCE($3, observacao),
             telefone = COALESCE($4, telefone),
             setor_destino = COALESCE($5, setor_destino),
             profissional_equipe = COALESCE($6, profissional_equipe),
             solucao = COALESCE($7, solucao),
             solucao_autor = COALESCE($8, solucao_autor),
             detalhes_json = COALESCE($9, detalhes_json),
             anexo_base64 = CASE WHEN COALESCE($2, status) = 'corrigida' THEN NULL ELSE COALESCE($10, anexo_base64) END,
             anexo_tipo = CASE WHEN COALESCE($2, status) = 'corrigida' THEN NULL ELSE COALESCE($11, anexo_tipo) END,
             anexo_nome = CASE WHEN COALESCE($2, status) = 'corrigida' THEN NULL ELSE COALESCE($12, anexo_nome) END,
             anexo_bytes = CASE WHEN COALESCE($2, status) = 'corrigida' THEN 0 ELSE COALESCE($13, anexo_bytes) END,
             solucao_em = CASE WHEN $7 IS NOT NULL THEN CURRENT_TIMESTAMP ELSE solucao_em END,
             resolvida_em = CASE
               WHEN COALESCE($2, status) = 'corrigida' THEN COALESCE(resolvida_em, CURRENT_TIMESTAMP)
               ELSE NULL
             END
         WHERE id = $1
         RETURNING ${COLS_DEVOLUCAO_LISTA}`,
        [
          id,
          statusFinal,
          limparCampoStr(req.body?.observacao, 1000),
          limparCampoStr(req.body?.telefone, 50),
          setorReq,
          limparCampoStr(req.body?.profissional_equipe, 120),
          solucao,
          solucaoAutor,
          detalhesJson,
          anexoBase64Arg,
          anexoTipoArg,
          anexoNomeArg,
          anexoBytesArg
        ]
      );
      if (r.rows.length === 0) {
        return res.status(404).json({ error: 'Registro de devolução não encontrado.' });
      }
      const updated = r.rows[0];
      let chatNotificado = false;
      if (temSolucaoNova && req.body?.notificar_chat !== false && !jaRespondidaMesmaSolucao && !jaCorrigida) {
        try {
          const textoSolucao = formatarMensagemChatDevolucao(updated, 'solucao');
          const autorMsg = solucaoAutor || updated.setor_destino || 'Profissional';
          await pool.query(
            `INSERT INTO chat_channels (canal, autor, texto, urgente) VALUES ($1, $2, $3, $4)`,
            ['regulacao', autorMsg, textoSolucao, true]
          );
          chatNotificado = true;
        } catch (_) {}
      }
      res.json({ ...updated, chat_notificado: chatNotificado });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/sisreg/devolucoes/:id', async (req, res) => {
    try {
      await garantirTabelaRegulacao(pool);
      const id = parseInt(req.params.id, 10);
      await pool.query('DELETE FROM regulacao_devolucoes WHERE id = $1', [id]);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = {
  SISREG_META_PADRAO,
  SINONIMOS_SISREG,
  repararMojibake,
  parsearHtmlCatalogoSisreg,
  validarCNS,
  validarTelefoneBR,
  verificarEnderecoRecife,
  calcularIdadeDataBR,
  classificarFaixaEtariaSisreg,
  compativelFaixaEtariaEVaga,
  buscarProcedimentosSisreg,
  formatarObservacaoSisreg,
  parsearBlocosTextoObservacoesSisreg,
  analisarHistoricoObservacoesSisreg,
  normalizarResultadoOcrSisreg,
  executarValidacoesFichaSisreg,
  carregarCatalogoSisregAtivo,
  SETORES_DESTINO_DEVOLUCAO,
  PRAZO_DEVOLUCAO_DIAS,
  MAX_PRORROGACOES_DEVOLUCAO,
  MAX_ANEXO_DEVOLUCAO_BYTES,
  normalizarDetalhesDevolucao,
  validarAnexoDevolucao,
  calcularStatusPrazoDevolucao,
  limparAnexosDevolucoesExpirados,
  inferirSetorDestinoDevolucao,
  normalizarSetorDestinoDevolucao,
  resolverCanalChatDevolucao,
  normalizarStatusDevolucao,
  pertenceAoProfissionalDevolucao,
  formatarMensagemChatDevolucao,
  setupSisreg
};
