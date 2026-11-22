// Módulo Frontend — Copiloto da Regulação (SISREG III · US 177 USF Chico Mendes · DS5)
(function () {
  const SISREG_UNIDADE_DEFAULT = 'US 177 USF CHICO MENDES';
  const SISREG_CNES_DEFAULT = '0000965';
  const SISREG_DISTRITO_DEFAULT = 'DS5';
  const SISREG_CONTATO_FALLBACK = 'Coordenador do DS5';
  const MAX_SISREG_PDF_BYTES = 2_000_000;

  let _sisregCatalogo = null;
  let _sisregCatalogoPromise = null;
  let _sisregDevolucoes = [];
  let _sisregDevolucoesTodas = [];
  let _sisregAbaAtiva = 'leitor'; // 'leitor' | 'busca' | 'devolucoes'
  let _sisregDevFiltro = 'abertas';
  let _sisregDevSetorFiltro = 'todos';
  let _sisregDevBusca = '';
  const _devProfModalState = { setor: 'Médico', status: 'abertas', busca: '' };
  let _copilotoPdfBlobUrl = null;
  let _medPdfBlobUrl = null;

  const PROFISSIONAIS_DEVOLUCAO_POR_SETOR = {
    'Médico': ['Dr. Israel Christian', 'Dr. Joene Halan', 'Dra. Mirela Mota'],
    'Enfermagem': ['Mariana Vaz', 'Jorge Marcio', 'Lucelia de Abreu'],
    'Odontologia': ['Dra. Juliana Cavalcante'],
    'ACS': [
      'Ana Paula', 'Ana Lúcia', 'Lenilda', 'Conceição', 'Joselita',
      'Alda', 'Simone', 'Patrícia', 'Telma', 'Jeane',
      'Josélia', 'Arlinda', 'Nena', 'Rosilene', 'Fátima'
    ]
  };

  const SETOR_DEV_META = {
    'Médico': { icon: '🩺', bg: '#eff6ff', fg: '#1e40af', canal: 'medico' },
    'Enfermagem': { icon: '👩‍⚕️', bg: '#f0fdfa', fg: '#0f766e', canal: 'enfermagem' },
    'Odontologia': { icon: '🦷', bg: '#fdf2f8', fg: '#be185d', canal: 'odontologia' },
    'ACS': { icon: '🧡', bg: '#fff7ed', fg: '#c2410c', canal: 'acs' }
  };

  const _copilotoState = {
    patientId: null,
    patientNomeFila: '',
    anexos: [],
    anexoIdx: 0,
    arquivoTipo: null, // 'image' | 'pdf' | null
    pdfBase64: null,
    pdfNome: '',
    semAcentoMaiusculo: false,
    verOriginal: false,
    telefoneConferido: false,
    dados: criarDadosVaziosSisreg(),
    sugestoes: [],
    zoom: 1,
    rot: 0,
    panX: 0,
    panY: 0,
    analisando: false
  };

  const _modalMedState = {
    setor: 'Médico',
    aba: 'busca', // 'busca' | 'leitor'
    arquivoTipo: null,
    imgBase64: null,
    pdfNome: '',
    dados: criarDadosVaziosSisreg(),
    sugestoes: [],
    resultadosBusca: [],
    analisando: false,
    semAcentoMaiusculo: false,
    zoom: 1,
    rot: 0,
    panX: 0,
    panY: 0
  };

  const SINONIMOS_FRONT = {
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
  const STOPWORDS_FRONT = new Set(['de', 'da', 'do', 'dos', 'das', 'em', 'para', 'p/', 'com', 'c/', 'sem', 'e', 'ou', 'a', 'o', 'os', 'as', 'ao', 'no', 'na']);
  const SIGLAS_SO_SINONIMO_FRONT = new Set(['tc', 'tomo', 'rnm', 'rm', 'usg', 'us', 'eco', 'ecott', 'eda', 'espiro', 'densi', 'dmo', 'mamo', 'mmg', 'orl', 'go', 'tv', 'colono', 'reto', 'peate', 'ped', 'lab', 'laboratorio']);
  const SIGLAS_EXATAS_FRONT = new Set(['bera', 'mapa', 'ecg', 'eeg', 'enmg', 'emg', 'psa', 'tsh', 'hba1c', 'hbgl', 'eas', 'vdrl', 'iono', 'rx', 'mid', 'mie', 'msd', 'mse']);

  function escRxFront(s) {
    return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function correspondeVarianteFront(texto, variante) {
    if (!texto || !variante) return false;
    if (variante.startsWith('>') || variante.startsWith('<')) {
      return texto.includes(variante);
    }
    if (variante.includes(' ')) {
      if (new RegExp(`(?:^|[^a-z0-9])${escRxFront(variante)}(?:$|[^a-z0-9])`).test(texto)) {
        return true;
      }
      const words = variante.split(/\s+/).filter(w => w.length > 1 && !STOPWORDS_FRONT.has(w));
      return words.length > 0 && words.every(w => new RegExp(`(?:^|[^a-z0-9])${escRxFront(w)}`).test(texto));
    }
    if (SIGLAS_EXATAS_FRONT.has(variante) || variante.length <= 2) {
      return new RegExp(`(?:^|[^a-z0-9])${escRxFront(variante)}(?:$|[^a-z0-9])`).test(texto);
    }
    return new RegExp(`(?:^|[^a-z0-9])${escRxFront(variante)}`).test(texto);
  }

  function criarDadosVaziosSisreg() {
    return {
      tipo_arquivo: 'ficha_ambulatorial',
      codigo_solicitacao: '',
      paciente_nome: '',
      paciente_cns: '',
      paciente_dn: '',
      paciente_sexo: '',
      paciente_mae: '',
      paciente_telefone: '',
      paciente_endereco: '',
      paciente_bairro: '',
      paciente_cep: '',
      paciente_municipio: 'Recife',
      paciente_uf: 'PE',
      tipo_vaga: '',
      risco: '',
      especialidade_ou_exame: '',
      procedimentos_pedidos: [],
      hipotese_diagnostica: '',
      cid10: '',
      medico_solicitante: '',
      crm_conselho: '',
      data_solicitacao: '',
      tem_assinatura_carimbo: null,
      observacoes_original: '',
      observacoes_revisada: '',
      alertas_digitacao: [],
      confianca: null
    };
  }

  function escSisreg(v) {
    if (typeof escapeText === 'function') return escapeText(v);
    return String(v || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function normSisregFront(v) {
    return String(v || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getApiUrlBase() {
    return typeof API_URL !== 'undefined' ? API_URL : '/api';
  }

  function getHojeRecifeKey() {
    if (typeof getDataHojeRecife === 'function') return getDataHojeRecife();
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Recife', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(new Date());
    } catch (_) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  function getContadorLidasHoje() {
    try {
      const k = `sisreg_lidas_${getHojeRecifeKey()}`;
      return parseInt(localStorage.getItem(k) || '0', 10) || 0;
    } catch (_) {
      return 0;
    }
  }

  function isDataUrlPdfSisreg(str, mime) {
    return mime === 'application/pdf' || (typeof str === 'string' && str.trim().toLowerCase().startsWith('data:application/pdf'));
  }

  function criarBlobUrlPdfSisreg(dataUrl) {
    try {
      const b64 = String(dataUrl || '').includes(',') ? String(dataUrl).split(',')[1] : String(dataUrl || '');
      const binStr = atob(b64);
      const len = binStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binStr.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      return URL.createObjectURL(blob);
    } catch (_) {
      return null;
    }
  }

  function revogarCopilotoPdfBlobUrl() {
    if (_copilotoPdfBlobUrl) {
      try { URL.revokeObjectURL(_copilotoPdfBlobUrl); } catch (_) {}
      _copilotoPdfBlobUrl = null;
    }
  }

  function revogarMedPdfBlobUrl() {
    if (_medPdfBlobUrl) {
      try { URL.revokeObjectURL(_medPdfBlobUrl); } catch (_) {}
      _medPdfBlobUrl = null;
    }
  }

  function incrementarContadorLidasHoje() {
    try {
      const k = `sisreg_lidas_${getHojeRecifeKey()}`;
      const next = (parseInt(localStorage.getItem(k) || '0', 10) || 0) + 1;
      localStorage.setItem(k, String(next));
      const el1 = document.getElementById('sisreg-lidas-hoje-badge');
      const el2 = document.getElementById('sisreg-lidas-hoje-modal');
      if (el1) el1.textContent = `📊 Lidas hoje: ${next}`;
      if (el2) el2.textContent = `📊 Lidas hoje: ${next}`;
    } catch (_) {}
  }

  function copiarTextoSisreg(texto, label) {
    const val = String(texto || '').trim();
    if (!val) {
      if (typeof showToast === 'function') showToast(`Nada para copiar em ${label}.`, true);
      return;
    }
    const okMsg = `📋 ${label} copiado para colar no SISREG!`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(val).then(() => {
        if (typeof showToast === 'function') showToast(okMsg);
      }).catch(() => fallbackCopyText(val, okMsg));
    } else {
      fallbackCopyText(val, okMsg);
    }
  }

  function fallbackCopyText(val, okMsg) {
    try {
      const ta = document.createElement('textarea');
      ta.value = val;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      if (typeof showToast === 'function') showToast(okMsg);
    } catch (_) {
      if (typeof showToast === 'function') showToast('Não foi possível copiar automaticamente.', true);
    }
  }

  // ===== VALIDADORES LOCAIS EM TEMPO REAL =====
  function validarCnsFront(cnsRaw) {
    const limpo = String(cnsRaw || '').replace(/\D/g, '');
    if (!limpo) return { valido: null, limpo: '', motivo: 'Não informado' };
    if (limpo.length !== 15) return { valido: false, limpo, motivo: `${limpo.length} dígitos (esperado 15)` };
    if (/^(\d)\1{14}$/.test(limpo)) return { valido: false, limpo, motivo: 'Dígitos repetidos' };
    const primeiro = limpo[0];
    let ok = false;
    if (primeiro === '1' || primeiro === '2') {
      const pis = limpo.substring(0, 11);
      let soma = 0;
      for (let i = 0; i < 11; i++) soma += parseInt(pis[i], 10) * (15 - i);
      let dv = 11 - (soma % 11);
      if (dv === 11) dv = 0;
      let res = '';
      if (dv === 10) {
        soma += 2;
        dv = 11 - (soma % 11);
        res = `${pis}001${dv}`;
      } else {
        res = `${pis}000${dv}`;
      }
      ok = res === limpo;
    } else if (primeiro === '7' || primeiro === '8' || primeiro === '9') {
      let soma = 0;
      for (let i = 0; i < 15; i++) soma += parseInt(limpo[i], 10) * (15 - i);
      ok = soma % 11 === 0;
    }
    return {
      valido: ok,
      limpo,
      motivo: ok ? 'CNS válido' : 'Dígito verificador inválido'
    };
  }

  function formatarTelefoneMask(val) {
    let d = String(val || '').replace(/\D/g, '');
    if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
    d = d.slice(0, 11);
    if (d.length === 0) return '';
    if (d.length <= 2) return `(${d}`;
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }

  function validarTelefoneFront(telRaw) {
    let d = String(telRaw || '').replace(/\D/g, '');
    if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
    if (!d) {
      return { valido: false, celular: false, digits: '', fmt: '', alerta: 'Telefone ausente — peça ao usuário!' };
    }
    if (d.length === 9 && d.startsWith('9')) d = `81${d}`;
    else if (d.length === 8) d = `81${d}`;
    if (d.length === 11 && d[2] === '9') {
      return {
        valido: true,
        celular: true,
        digits: d,
        fmt: `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`,
        alerta: null
      };
    }
    if (d.length === 10) {
      return {
        valido: true,
        celular: false,
        digits: d,
        fmt: `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`,
        alerta: 'Telefone fixo/sem dígito 9 — prefira celular.'
      };
    }
    return {
      valido: false,
      celular: false,
      digits: d,
      fmt: String(telRaw || '').trim(),
      alerta: `Telefone incompleto (${d.length} dígitos) — confira!`
    };
  }

  function calcularIdadeFront(dnStr) {
    const m = String(dnStr || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    const dia = parseInt(m[1], 10);
    const mes = parseInt(m[2], 10);
    const ano = parseInt(m[3], 10);
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || ano < 1900 || ano > 2100) return null;
    const hojeParts = getHojeRecifeKey().split('-').map(Number);
    let idade = hojeParts[0] - ano;
    if (hojeParts[1] < mes || (hojeParts[1] === mes && hojeParts[2] < dia)) idade--;
    return idade >= 0 && idade <= 125 ? idade : null;
  }

  const CIDADES_FORA_RECIFE = [
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
    { rx: /\bipojuca\b/, nome: 'Ipojuca' }
  ];

  function verificarEnderecoRecifeFront({ municipio, uf, cep, endereco }) {
    const munNorm = normSisregFront(municipio);
    const ufNorm = normSisregFront(uf);
    const endNorm = normSisregFront(endereco);
    const cepDigits = String(cep || '').replace(/\D/g, '');
    const motivos = [];

    if (ufNorm && ufNorm !== 'pe' && ufNorm !== 'pernambuco') {
      motivos.push(`UF "${String(uf).toUpperCase()}" ≠ PE`);
    }
    if (munNorm && munNorm !== 'recife') {
      motivos.push(`Município "${municipio}" ≠ Recife`);
    }
    if (cepDigits.length === 8) {
      const cepNum = parseInt(cepDigits, 10);
      if (cepNum < 50000000 || cepNum > 52999999) {
        const cepFmt = `${cepDigits.slice(0, 5)}-${cepDigits.slice(5)}`;
        motivos.push(`CEP ${cepFmt} fora da faixa de Recife (50000 a 52999)`);
      }
    } else if (cepDigits.length > 0 && cepDigits.length !== 8) {
      motivos.push(`CEP incompleto (${cepDigits})`);
    }
    if (endNorm) {
      for (const c of CIDADES_FORA_RECIFE) {
        if (c.rx.test(endNorm)) {
          const ehRua = new RegExp(`\\b(?:rua|av|avenida|travessa|estrada)\\s+[^,]*${c.rx.source}`, 'i').test(endNorm);
          if (!ehRua || (munNorm && munNorm !== 'recife')) {
            motivos.push(`Endereço cita "${c.nome}"`);
            break;
          }
        }
      }
    }

    if (motivos.length > 0) {
      return { status: 'fora_recife', alerta: `🚫 Risco de DEVOLUÇÃO por endereço fora de Recife: ${motivos.join(' · ')}`, motivos };
    }
    if (!munNorm && cepDigits.length !== 8 && !endNorm) {
      return { status: 'incompleto', alerta: 'Endereço/Município não confirmado — verifique se reside em Recife-PE.', motivos: [] };
    }
    return { status: 'ok', alerta: null, motivos: [] };
  }

  function formatarObservacaoFront(texto, semAcentoMaiusculo) {
    let s = String(texto || '').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    if (semAcentoMaiusculo) {
      s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    }
    return s;
  }

  // ===== MOTOR DE BUSCA SISREG NO CLIENTE (0ms) =====
  async function garantirCatalogoSisregCarregado(forcar = false) {
    if (_sisregCatalogo && !forcar) return _sisregCatalogo;
    if (_sisregCatalogoPromise && !forcar) return _sisregCatalogoPromise;
    _sisregCatalogoPromise = fetch(`${getApiUrlBase()}/sisreg/catalogo`, { cache: 'no-store' })
      .then(r => {
        if (!r.ok) throw new Error('Falha ao carregar catálogo SISREG');
        return r.json();
      })
      .then(data => {
        _sisregCatalogo = data;
        atualizarRodapeCatalogoUI();
        return data;
      })
      .catch(err => {
        console.warn('[sisreg]', err.message);
        return _sisregCatalogo || {
          versao: '—',
          unidade: SISREG_UNIDADE_DEFAULT,
          cnes: SISREG_CNES_DEFAULT,
          distrito: SISREG_DISTRITO_DEFAULT,
          contato_nao_encontrado: SISREG_CONTATO_FALLBACK,
          total: 0,
          procedimentos: []
        };
      })
      .finally(() => {
        _sisregCatalogoPromise = null;
      });
    return _sisregCatalogoPromise;
  }

  function classificarFaixaEtariaFront(nomeNorm, hierNorm) {
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

  function compativelFaixaEtariaEVagaFront(nomeNorm, hierNorm, { idade, tipoVaga } = {}) {
    if (tipoVaga === 'retorno' || tipoVaga === 'primeira_vez') {
      const isRetorno = /\bretorno\b/.test(nomeNorm);
      if (tipoVaga === 'retorno' && !isRetorno) return false;
      if (tipoVaga === 'primeira_vez' && isRetorno) return false;
    }
    if (idade !== null && idade !== undefined && String(idade).trim() !== '' && Number.isFinite(Number(idade))) {
      const id = Number(idade);
      const { isPed, isTeen14a17, isIdoso, isAdultoMaior } = classificarFaixaEtariaFront(nomeNorm, hierNorm);
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

  function pontuarFaixaEtariaFront(nomeNorm, hierNorm, idade) {
    if (idade === null || idade === undefined || !Number.isFinite(Number(idade))) return 0;
    const id = Number(idade);
    const { isPed, isTeen14a17, isIdoso, isAdultoMaior } = classificarFaixaEtariaFront(nomeNorm, hierNorm);
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

  function buscarProcedimentosFront(query, opts = {}) {
    const lista = _sisregCatalogo?.procedimentos || [];
    const qStr = String(query || '').trim();
    const tipoFiltro = opts.tipo && opts.tipo !== 'all' ? opts.tipo : null;
    const idade = opts.idade !== undefined && opts.idade !== null && opts.idade !== '' ? Number(opts.idade) : null;
    const tipoVaga = opts.tipoVaga || null;
    const limite = Number(opts.limite) > 0 ? Number(opts.limite) : 40;

    if (!qStr) {
      const temIdade = idade !== null && Number.isFinite(idade);
      const temVaga = tipoVaga === 'retorno' || tipoVaga === 'primeira_vez';
      const filtrados = lista
        .filter(p => {
          if (tipoFiltro && p.type !== tipoFiltro) return false;
          const nameRawNorm = normSisregFront(p.name);
          const hierNorm = normSisregFront(p.hierarchy || '');
          return compativelFaixaEtariaEVagaFront(nameRawNorm, hierNorm, { idade, tipoVaga });
        })
        .map(p => {
          const nameRawNorm = normSisregFront(p.name);
          const hierNorm = normSisregFront(p.hierarchy || '');
          const isRetorno = /\bretorno\b/.test(nameRawNorm);
          let score = 1;
          if (temIdade) score += pontuarFaixaEtariaFront(nameRawNorm, hierNorm, idade);
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
    const base = normSisregFront(qStr)
      .replace(/ultra[\s-]*sonograf[ia]+/g, 'ultrassonografia')
      .replace(/\braio[\s-]*x\b/g, 'radiografia');
    const tokens = base.split(/[^a-z0-9<>]+/).filter(Boolean).filter(t => !STOPWORDS_FRONT.has(t));
    const grupos = tokens.map(tok => {
      const set = new Set();
      if (!SIGLAS_SO_SINONIMO_FRONT.has(tok) || !SINONIMOS_FRONT[tok]) {
        set.add(tok);
      }
      if (tok === 'ultrassonografia') set.add('ultra-sonografia');
      const syns = SINONIMOS_FRONT[tok];
      if (Array.isArray(syns)) {
        syns.forEach(s => {
          const sn = normSisregFront(s);
          if (sn) set.add(sn);
        });
      }
      return { original: tok, variantes: Array.from(set) };
    });

    const resultados = [];
    for (const proc of lista) {
      if (tipoFiltro && proc.type !== tipoFiltro) continue;
      const code = String(proc.code || '');
      const codeNorm = normSisregFront(code);
      const nameRawNorm = normSisregFront(proc.name);
      const nameUnified = nameRawNorm
        .replace(/ultra[\s-]*sonograf[ia]+/g, 'ultrassonografia')
        .replace(/\braio[\s-]*x\b/g, 'radiografia');
      const hierNorm = normSisregFront(proc.hierarchy || '');
      if (!compativelFaixaEtariaEVagaFront(nameRawNorm, hierNorm, { idade, tipoVaga })) continue;
      const fullText = `${nameRawNorm} ${nameUnified} ${hierNorm} ${codeNorm}`;

      let score = 0;
      if (qDigits.length >= 6 && codeNorm.includes(qDigits)) {
        score += codeNorm === qDigits ? 200 : 140;
      }

      if (score === 0 && grupos.length > 0) {
        let matched = 0;
        for (const g of grupos) {
          const hitName = g.variantes.some(v => correspondeVarianteFront(nameRawNorm, v) || correspondeVarianteFront(nameUnified, v));
          const hitHier = !hitName && g.variantes.some(v => correspondeVarianteFront(hierNorm, v));
          const hitCode = g.original.length >= 4 && /^\d+$/.test(g.original) && codeNorm.includes(g.original);
          if (hitName) {
            matched++;
            score += g.variantes[0] === g.original && correspondeVarianteFront(nameRawNorm, g.original) ? 35 : 28;
          } else if (hitHier || hitCode) {
            matched++;
            score += 18;
          }
        }
        if (matched < grupos.length) continue;
        if ((!SIGLAS_SO_SINONIMO_FRONT.has(base) || !SINONIMOS_FRONT[base]) &&
            (correspondeVarianteFront(nameRawNorm, base) || correspondeVarianteFront(nameUnified, base))) {
          score += 30;
        }
      } else if (score === 0) {
        if (!fullText.includes(base)) continue;
        score = 20;
      }

      score += pontuarFaixaEtariaFront(nameRawNorm, hierNorm, idade);

      const isRetorno = /\bretorno\b/.test(nameRawNorm);
      if (tipoVaga === 'retorno') score += isRetorno ? 40 : -10;
      else if (tipoVaga === 'primeira_vez') score += isRetorno ? -25 : 15;

      if (String(proc.hierarchy || '').includes('>')) score += 5;
      resultados.push({ ...proc, score });
    }

    resultados.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'pt-BR'));
    return resultados.slice(0, limite);
  }

  function atualizarRodapeCatalogoUI(exibidos = null) {
    const prefix = typeof exibidos === 'number' ? `Exibindo ${exibidos} · ` : '';
    const txt = _sisregCatalogo
      ? `${prefix}Tabela SISREG: ${_sisregCatalogo.total || 0} procedimentos · Atualizada em ${_sisregCatalogo.versao || '—'} · ${SISREG_UNIDADE_DEFAULT} · ${SISREG_DISTRITO_DEFAULT}`
      : 'Carregando tabela SISREG...';
    const el1 = document.getElementById('sisreg-busca-footer-meta');
    const el2 = document.getElementById('sisreg-med-footer-meta');
    if (el1) el1.textContent = txt;
    if (el2) el2.textContent = txt;
  }

  // ===== COMPRESSÃO DE IMAGEM / LEITURA PDF =====
  function comprimirImagemSisreg(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Falha ao ler imagem'));
      reader.onload = (ev) => {
        const img = new Image();
        img.onerror = () => resolve(ev.target.result);
        img.onload = () => {
          const MAX = 1350;
          let w = img.width;
          let h = img.height;
          if (w > MAX || h > MAX) {
            if (w > h) { h = Math.round(h * (MAX / w)); w = MAX; }
            else { w = Math.round(w * (MAX / h)); h = MAX; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.80));
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function lerPdfBase64(file) {
    return new Promise((resolve, reject) => {
      if (file.size > MAX_SISREG_PDF_BYTES) {
        reject(new Error('PDF maior que 2,8 MB. Tire um print/foto da página ou use um PDF menor.'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Falha ao ler arquivo PDF'));
      reader.onload = (ev) => resolve(ev.target.result);
      reader.readAsDataURL(file);
    });
  }

  async function lerArquivoHtmlCatalogoText(file) {
    const buf = await file.arrayBuffer();
    const u8 = new Uint8Array(buf);
    if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(u8.subarray(2));
    }
    if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(u8.subarray(2));
    }
    return new TextDecoder('utf-8').decode(u8);
  }

  // ===== BARRA COMPACTA NA REGULAÇÃO + MODAL "SEGUNDA TELA" =====
  function initCopilotoRegulacao() {
    const root = document.getElementById('regulacao-copiloto-root');
    if (root) {
      root.innerHTML = `
        <div class="pec-forms-bar" style="margin-bottom:14px;">
          <span class="pec-forms-title">📋 Prévia Regulação (SISREG):</span>
          <button type="button" class="pec-form-btn sisreg" onclick="abrirModalPreviaRegulacao('leitor')">👁️ Abrir Prévia SISREG <span class="previa-teste-tag">Liberado para teste</span></button>
          <button type="button" class="pec-form-btn" onclick="abrirModalPreviaRegulacao('busca')">🔎 Busca SISREG</button>
          <button type="button" class="pec-form-btn" onclick="abrirModalPreviaRegulacao('devolucoes')">↩️ Devoluções <span id="sisreg-dev-badge-bar" class="sisreg-dev-count" style="display:none;">0</span></button>
          <span id="sisreg-lidas-hoje-badge" class="sisreg-stat-pill dark" style="margin-left:auto;">📊 Lidas hoje: ${getContadorLidasHoje()}</span>
        </div>
      `;
    }
    garantirModalPreviaRegulacaoMontado();
    garantirCatalogoSisregCarregado();
    carregarDevolucoesSisreg();
  }

  function garantirModalPreviaRegulacaoMontado() {
    const modal = document.getElementById('modal-previa-regulacao');
    if (!modal || modal.dataset.mounted === '1') return;
    modal.dataset.mounted = '1';

    modal.innerHTML = `
      <div class="previa-modal-card wide">
        <div class="previa-modal-head" style="background:linear-gradient(135deg,#0f2c73,#0f766e);">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <div style="font-weight:900;font-size:15.5px;">📋 Prévia Regulação — SISREG III (${SISREG_UNIDADE_DEFAULT} · ${SISREG_DISTRITO_DEFAULT})</div>
            <span class="previa-teste-pill">🧪 Liberado para teste</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <span id="sisreg-lidas-hoje-modal" class="sisreg-stat-pill">📊 Lidas hoje: ${getContadorLidasHoje()}</span>
            <button type="button" class="previa-btn-close-red" onclick="fecharModalPreviaRegulacao()" title="Fechar esta tela (não use o botão Voltar do navegador)">✕ Fechar</button>
          </div>
        </div>

        <div class="previa-modal-body" style="background:#f8fafc;">
          <div class="sisreg-tabs-row">
            <button type="button" class="sisreg-tab-btn ${_sisregAbaAtiva === 'leitor' ? 'active' : ''}" id="sisreg-tab-leitor" onclick="trocarAbaCopilotoRegulacao('leitor')">📷 Prévia / Ficha + PDF</button>
            <button type="button" class="sisreg-tab-btn ${_sisregAbaAtiva === 'busca' ? 'active' : ''}" id="sisreg-tab-busca" onclick="trocarAbaCopilotoRegulacao('busca')">🔎 Busca de Procedimentos SISREG</button>
            <button type="button" class="sisreg-tab-btn ${_sisregAbaAtiva === 'devolucoes' ? 'active' : ''}" id="sisreg-tab-devolucoes" onclick="trocarAbaCopilotoRegulacao('devolucoes')">↩️ Devoluções <span id="sisreg-dev-badge" class="sisreg-dev-count" style="display:none;">0</span></button>
          </div>

          <!-- ABA 1: PRÉVIA / LEITOR DE FICHA E PDF -->
          <div id="sisreg-pane-leitor" style="${_sisregAbaAtiva === 'leitor' ? '' : 'display:none;'}">
            <div class="sisreg-toolbar">
              <input type="file" id="sisreg-file-cam" accept="image/*" capture="environment" style="display:none;" onchange="if(this.files&&this.files.length)processarArquivosCopilotoSisreg(this.files);this.value='';">
              <input type="file" id="sisreg-file-upload" accept="image/*,application/pdf" multiple style="display:none;" onchange="if(this.files&&this.files.length)processarArquivosCopilotoSisreg(this.files);this.value='';">
              <button type="button" class="btn btn-primary btn-sm" onclick="document.getElementById('sisreg-file-cam').click()">📸 Tirar Foto da Ficha</button>
              <button type="button" class="btn btn-outline btn-sm" onclick="document.getElementById('sisreg-file-upload').click()">📄 Escolher Foto / PDF (Ctrl+V)</button>
              <button type="button" class="btn btn-sm" style="background:#f1f5f9;color:#0f172a;border:1px solid #cbd5e1;font-weight:800;" onclick="limparFichaCopilotoSisreg()">🔄 Nova Prévia</button>
              <div id="sisreg-pac-vinculado-pill" class="sisreg-pac-pill" style="display:none;">
                <span>👤 Fila: <strong id="sisreg-pac-vinculado-nome"></strong></span>
                <button type="button" id="sisreg-btn-reanalisar-vinculado" onclick="reanalisarAnexoAtivoCopiloto()" class="sisreg-mini-link" title="Ler novamente o documento">🔄 Reler Prévia</button>
                <button type="button" id="sisreg-btn-salvar-fila" onclick="salvarFotoCopilotoNoPaciente()" class="sisreg-mini-link ok" title="Salvar anexo e dados neste paciente da fila">💾 Salvar no Paciente</button>
                <button type="button" onclick="desvincularPacienteCopiloto()" style="background:transparent;border:none;color:#991b1b;font-weight:900;cursor:pointer;" title="Desvincular">✕</button>
              </div>
            </div>

            <div id="sisreg-ocr-status" class="pr-status-box" style="display:none;"></div>

            <div class="sisreg-split-grid">
              <!-- ESQUERDA: VISUALIZADOR COM ZOOM / GARRINHA / PDF NATIVO -->
              <div>
                <div id="sisreg-img-nav" class="vp-nav-bar" style="display:none;">
                  <button type="button" class="btn btn-sm" style="background:#334155;color:#fff;" onclick="navegarFotoCopiloto(-1)">◀ Anterior</button>
                  <span id="sisreg-img-counter" style="font-size:12px;font-weight:900;">Arquivo 1 de 1</span>
                  <button type="button" class="btn btn-sm" style="background:#334155;color:#fff;margin-left:auto;" onclick="navegarFotoCopiloto(1)">Próximo ▶</button>
                </div>
                <div id="sisreg-img-controls" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px;">
                  <button type="button" class="btn btn-outline btn-sm" onclick="zoomCopilotoImg(-0.25)">➖ Zoom</button>
                  <button type="button" class="btn btn-outline btn-sm" onclick="zoomCopilotoImg(0.25)">➕ Zoom</button>
                  <button type="button" class="btn btn-outline btn-sm" onclick="girarCopilotoImg()">🔄 90°</button>
                  <button type="button" class="btn btn-outline btn-sm" onclick="resetCopilotoImgView()">🎯 100%</button>
                  <span id="sisreg-zoom-label" class="previa-zoom-pill">100%</span>
                  <a id="sisreg-btn-download-ativo" href="" download="previa-sisreg" class="btn btn-outline btn-sm" style="display:none;text-decoration:none;">⬇️ Baixar</a>
                  <span class="previa-pan-hint">✋ Arraste · Scroll p/ zoom</span>
                </div>
                <div class="previa-img-stage" id="sisreg-img-stage">
                  <img id="sisreg-stage-img" src="" alt="Ficha Ambulatorial" draggable="false" style="display:none;">
                  <iframe id="sisreg-stage-pdf-iframe" class="previa-pdf-frame" style="display:none;" title="Prévia PDF SISREG"></iframe>
                  <div id="sisreg-stage-empty" class="sisreg-stage-empty">
                    📷 Tire foto da <strong>Ficha de Solicitação Ambulatorial</strong>, anexe <strong>PDF</strong> ou cole com <strong>Ctrl+V</strong>.
                  </div>
                </div>
                <div id="sisreg-thumbs-strip" class="vp-thumbs-strip"></div>
              </div>

              <!-- DIREITA: EXTRAÇÃO + ANTI-DEVOLUÇÃO + BUSCA AUTOMÁTICA -->
              <div class="sisreg-form-col">
                <div id="sisreg-alertas-dinamicos"></div>

                <!-- BLOCO TELEFONE -->
                <div class="sisreg-box sisreg-box-tel">
                  <div class="sisreg-box-head">
                    <span>📞 Telefone do Usuário (O SISREG avisa quando marcar)</span>
                    <span id="sisreg-tel-status-badge" class="sisreg-pill-mini warn">A conferir</span>
                  </div>
                  <div class="sisreg-tel-row">
                    <input type="text" id="sr-telefone" placeholder="(81) 9XXXX-XXXX" oninput="onInputTelefoneSisreg(this.value)">
                    <button type="button" class="btn btn-primary btn-sm" onclick="copiarCampoSisreg('sr-telefone','Telefone (DDD)')">📋 Copiar</button>
                    <button type="button" class="btn btn-outline btn-sm" onclick="copiarTelefoneSoDigitos()">📋 Só Números</button>
                  </div>
                  <label class="sisreg-check-line">
                    <input type="checkbox" id="sr-tel-conferido" onchange="onToggleTelConferidoSisreg(this.checked)">
                    <span>✅ Telefone conferido / atualizado com o usuário no SISREG</span>
                  </label>
                </div>

                <!-- BLOCO OBSERVAÇÕES -->
                <div class="sisreg-box sisreg-box-obs">
                  <div class="sisreg-box-head">
                    <span>📝 Observações / Condições Clínicas (Copiar p/ SISREG)</span>
                    <div style="display:flex;gap:6px;align-items:center;">
                      <button type="button" id="sr-btn-toggle-orig" class="sisreg-mini-link" style="display:none;" onclick="alternarTextoOriginalObsSisreg()">Ver original</button>
                      <button type="button" class="btn btn-primary btn-sm" onclick="copiarObservacaoSisreg(false)">📋 Copiar Obs.</button>
                    </div>
                  </div>
                  <div id="sr-obs-conferir-box" class="sisreg-conferir-box" style="display:none;"></div>
                  <textarea id="sr-observacoes" rows="4" placeholder="Condições Clínicas / Justificativa extraídas para colar no SISREG..." oninput="onCampoSisregAlterado('observacoes_revisada', this.value)"></textarea>
                  <div class="sisreg-obs-footer">
                    <label style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:800;color:#1e3a8a;cursor:pointer;">
                      <input type="checkbox" id="sr-chk-maiusc" onchange="onToggleMaiusculasObs(this.checked)">
                      <span>MAIÚSCULAS sem acento</span>
                    </label>
                    <button type="button" class="btn btn-outline btn-sm" onclick="copiarObservacaoSisreg(true)">📋 Copiar Bloco (Hipótese + CID + Obs.)</button>
                  </div>
                </div>

                <!-- BLOCO PROCEDIMENTO ENCONTRADO NO SISREG -->
                <div class="sisreg-box sisreg-box-proc">
                  <div class="sisreg-box-head">
                    <span>🔎 Onde está no SISREG</span>
                    <button type="button" class="sisreg-mini-link" onclick="trocarAbaCopilotoRegulacao('busca')">Abrir Busca Completa →</button>
                  </div>
                  <div id="sisreg-proc-sugestoes">
                    <div class="sisreg-muted">Anexe ou pesquise um procedimento para ver o código e o grupo no SISREG.</div>
                  </div>
                </div>

                <!-- BLOCO IDENTIFICAÇÃO E SOLICITAÇÃO -->
                <div class="sisreg-box">
                  <div class="sisreg-box-head">
                    <span>👤 Dados do Paciente &amp; Solicitação (Editar / Copiar)</span>
                    <span id="sr-confianca-badge" class="sisreg-pill-mini" style="display:none;"></span>
                  </div>
                  <div class="sisreg-grid-2">
                    <div class="sisreg-field">
                      <label>Nome Completo</label>
                      <div class="sisreg-inp-copy">
                        <input type="text" id="sr-nome" oninput="onCampoSisregAlterado('paciente_nome', this.value)">
                        <button type="button" onclick="copiarCampoSisreg('sr-nome','Nome')" title="Copiar Nome">📋</button>
                      </div>
                    </div>
                    <div class="sisreg-field">
                      <label>CNS / CPF <span id="sr-cns-badge" class="sisreg-inline-badge"></span></label>
                      <div class="sisreg-inp-copy">
                        <input type="text" id="sr-cns" placeholder="15 dígitos" oninput="onCampoSisregAlterado('paciente_cns', this.value)">
                        <button type="button" onclick="copiarCampoSisreg('sr-cns','CNS')" title="Copiar CNS">📋</button>
                      </div>
                    </div>
                    <div class="sisreg-field">
                      <label>Data Nasc. <span id="sr-idade-badge" class="sisreg-inline-badge"></span></label>
                      <input type="text" id="sr-dn" placeholder="DD/MM/AAAA" oninput="onCampoSisregAlterado('paciente_dn', this.value)">
                    </div>
                    <div class="sisreg-field">
                      <label>Nome da Mãe</label>
                      <div class="sisreg-inp-copy">
                        <input type="text" id="sr-mae" oninput="onCampoSisregAlterado('paciente_mae', this.value)">
                        <button type="button" onclick="copiarCampoSisreg('sr-mae','Nome da Mãe')" title="Copiar">📋</button>
                      </div>
                    </div>
                    <div class="sisreg-field">
                      <label>Endereço / Bairro</label>
                      <input type="text" id="sr-endereco" oninput="onCampoSisregAlterado('paciente_endereco', this.value)">
                    </div>
                    <div class="sisreg-grid-cep">
                      <div class="sisreg-field">
                        <label>Município</label>
                        <input type="text" id="sr-municipio" oninput="onCampoSisregAlterado('paciente_municipio', this.value)">
                      </div>
                      <div class="sisreg-field">
                        <label>UF</label>
                        <input type="text" id="sr-uf" maxlength="2" oninput="onCampoSisregAlterado('paciente_uf', this.value)">
                      </div>
                      <div class="sisreg-field">
                        <label>CEP</label>
                        <input type="text" id="sr-cep" placeholder="50000-000" oninput="onCampoSisregAlterado('paciente_cep', this.value)">
                      </div>
                    </div>
                    <div class="sisreg-field">
                      <label>Procedimento / Especialidade Solicitada</label>
                      <div class="sisreg-inp-copy">
                        <input type="text" id="sr-especialidade" oninput="onCampoSisregAlterado('especialidade_ou_exame', this.value)">
                        <button type="button" onclick="rebuscarProcedimentosCopiloto()" title="Buscar no catálogo">🔎</button>
                      </div>
                    </div>
                    <div class="sisreg-grid-cep">
                      <div class="sisreg-field">
                        <label>CID-10</label>
                        <div class="sisreg-inp-copy">
                          <input type="text" id="sr-cid" oninput="onCampoSisregAlterado('cid10', this.value)">
                          <button type="button" onclick="copiarCampoSisreg('sr-cid','CID-10')" title="Copiar CID">📋</button>
                        </div>
                      </div>
                      <div class="sisreg-field">
                        <label>Tipo Vaga</label>
                        <select id="sr-tipo-vaga" onchange="onCampoSisregAlterado('tipo_vaga', this.value)">
                          <option value="">—</option>
                          <option value="primeira_vez">1ª Vez</option>
                          <option value="retorno">Retorno</option>
                        </select>
                      </div>
                      <div class="sisreg-field">
                        <label>Risco</label>
                        <select id="sr-risco" onchange="onCampoSisregAlterado('risco', this.value)">
                          <option value="">—</option>
                          <option value="azul">Azul</option>
                          <option value="verde">Verde</option>
                          <option value="amarelo">Amarelo</option>
                          <option value="vermelho">Vermelho</option>
                        </select>
                      </div>
                    </div>
                    <div class="sisreg-field" style="grid-column:1/-1;">
                      <label>Hipótese Diagnóstica</label>
                      <div class="sisreg-inp-copy">
                        <input type="text" id="sr-hipotese" oninput="onCampoSisregAlterado('hipotese_diagnostica', this.value)">
                        <button type="button" onclick="copiarCampoSisreg('sr-hipotese','Hipótese Diagnóstica')" title="Copiar">📋</button>
                      </div>
                    </div>
                    <div class="sisreg-field">
                      <label>Solicitante / CRM</label>
                      <input type="text" id="sr-solicitante" oninput="onCampoSisregAlterado('medico_solicitante', this.value)">
                    </div>
                    <div class="sisreg-field">
                      <label>Protocolo SISREG (se PDF)</label>
                      <div class="sisreg-inp-copy">
                        <input type="text" id="sr-protocolo" oninput="onCampoSisregAlterado('codigo_solicitacao', this.value)">
                        <button type="button" onclick="copiarCampoSisreg('sr-protocolo','Código da Solicitação')" title="Copiar">📋</button>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- CHECKLIST ANTI-DEVOLUÇÃO -->
                <div id="sisreg-checklist-rodape" class="sisreg-checklist-bar"></div>
              </div>
            </div>
          </div>

          <!-- ABA 2: BUSCA DE PROCEDIMENTOS SISREG -->
          <div id="sisreg-pane-busca" style="${_sisregAbaAtiva === 'busca' ? '' : 'display:none;'}">
            <div class="sisreg-busca-bar">
              <input type="text" id="sisreg-busca-input" placeholder="Digite sigla, nome ou código (ex: USG tireoide, ECO, MAPA, Holter, Raio-X, BERA, 0205020127)..." oninput="executarBuscaManualSisreg()">
              <select id="sisreg-busca-tipo" onchange="executarBuscaManualSisreg()">
                <option value="all">Todos os Tipos</option>
                <option value="Consulta">Consultas</option>
                <option value="Exame">Exames</option>
                <option value="Procedimento">Procedimentos</option>
              </select>
              <select id="sisreg-busca-idade" onchange="executarBuscaManualSisreg()">
                <option value="">Qualquer Idade</option>
                <option value="8">Pediátrico (0 a 14)</option>
                <option value="35">Adulto (15 a 59)</option>
                <option value="65">Idoso (&gt; 60 anos)</option>
              </select>
              <select id="sisreg-busca-vaga" onchange="executarBuscaManualSisreg()">
                <option value="">1ª Vez / Retorno</option>
                <option value="primeira_vez">1ª Vez</option>
                <option value="retorno">Retorno</option>
              </select>
            </div>
            <div class="sisreg-busca-atalhos">
              <span>Atalhos:</span>
              <button type="button" class="motivo-chip" onclick="buscarAtalhoSisreg('USG')">USG</button>
          <button type="button" class="motivo-chip" onclick="buscarAtalhoSisreg('EXAMES DE LABORATORIO')">🧪 Exames Lab.</button>
              <button type="button" class="motivo-chip" onclick="buscarAtalhoSisreg('ECO')">Ecocardiografia</button>
              <button type="button" class="motivo-chip" onclick="buscarAtalhoSisreg('RADIOGRAFIA')">Raio-X</button>
              <button type="button" class="motivo-chip" onclick="buscarAtalhoSisreg('MAMOGRAFIA')">Mamografia</button>
              <button type="button" class="motivo-chip" onclick="buscarAtalhoSisreg('OFTALMO')">Oftalmo</button>
              <button type="button" class="motivo-chip" onclick="buscarAtalhoSisreg('CARDIO')">Cardio</button>
              <button type="button" class="motivo-chip" onclick="buscarAtalhoSisreg('ORTO')">Ortopedia</button>
              <button type="button" class="motivo-chip" onclick="buscarAtalhoSisreg('GINECO')">Gineco</button>
              <button type="button" class="motivo-chip" onclick="buscarAtalhoSisreg('DERMATO')">Dermato</button>
              <button type="button" class="motivo-chip" onclick="buscarAtalhoSisreg('EDA')">Endoscopia</button>
              <button type="button" class="motivo-chip" onclick="buscarAtalhoSisreg('COLONO')">Colonoscopia</button>
              <button type="button" class="motivo-chip" onclick="buscarAtalhoSisreg('HOLTER')">Holter</button>
              <button type="button" class="motivo-chip" onclick="buscarAtalhoSisreg('MAPA')">MAPA</button>
              <button type="button" class="motivo-chip" onclick="buscarAtalhoSisreg('ECG')">ECG</button>
              <button type="button" class="motivo-chip" onclick="buscarAtalhoSisreg('ESPIRO')">Espiro</button>
              <button type="button" class="motivo-chip" onclick="buscarAtalhoSisreg('BERA')">BERA</button>
            </div>
            <div class="sisreg-table-wrap" style="max-height:52vh;">
              <table class="sisreg-results-table">
                <thead>
                  <tr>
                    <th style="width:120px;">Código</th>
                    <th>Procedimento (Descrição Exata)</th>
                    <th style="width:95px;">Tipo</th>
                    <th>Onde encontrar no SISREG (Fluxo Hierárquico)</th>
                    <th style="width:125px;text-align:right;">Copiar</th>
                  </tr>
                </thead>
                <tbody id="sisreg-busca-tbody"></tbody>
              </table>
            </div>
            <div class="sisreg-busca-footer">
              <span id="sisreg-busca-footer-meta">Carregando tabela...</span>
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                <input type="file" id="sisreg-import-html-input" accept=".html,.htm" style="display:none;" onchange="if(this.files&&this.files[0])importarNovaTabelaSisreg(this.files[0]);this.value='';">
                <button type="button" class="btn btn-outline btn-sm" onclick="document.getElementById('sisreg-import-html-input').click()">📥 Atualizar Tabela SISREG (HTML)</button>
              </div>
            </div>
          </div>

          <!-- ABA 3: CONTROLE DIRECIONADO DE DEVOLUÇÕES -->
          <div id="sisreg-pane-devolucoes" style="${_sisregAbaAtiva === 'devolucoes' ? '' : 'display:none;'}">
            <div class="sisreg-dev-form">
              <div style="font-size:12.5px;font-weight:900;color:#1e3a8a;margin-bottom:8px;">↩️ Registrar e Direcionar Devolução no SISREG (com Alerta no Chat Interno)</div>
              <div class="sisreg-dev-grid">
                <input type="text" id="dev-pac-nome" placeholder="Nome do Paciente *">
                <input type="text" id="dev-protocolo" placeholder="Código Solicitação">
                <input type="text" id="dev-procedimento" placeholder="Procedimento / Especialidade">
                <select id="dev-motivo" onchange="onDevMotivoChange()">
                  <option value="Procedimento incorreto / faixa etária">Procedimento incorreto / faixa etária</option>
                  <option value="Falta justificativa clínica / exame prévio">Falta justificativa clínica / exame prévio</option>
                  <option value="Erro de digitação / texto clínico / CID">Erro de digitação / texto clínico / CID</option>
                  <option value="Endereço de outra cidade (fora de Recife) / Cadastro">Endereço / Cadastro desatualizado (ACS)</option>
                  <option value="Telefone / CNS / dados cadastrais desatualizados">Telefone / CNS desatualizado (ACS)</option>
                  <option value="Outro">Outro motivo</option>
                </select>
                <select id="dev-setor-destino" onchange="onDevSetorDestinoChange()" title="Setor responsável por verificar/corrigir">
                  <option value="Médico">🩺 Direcionar: Médico</option>
                  <option value="Enfermagem">👩‍⚕️ Direcionar: Enfermagem</option>
                  <option value="Odontologia">🦷 Direcionar: Odontologia</option>
                  <option value="ACS">🧡 Direcionar: ACS (Cadastro / Endereço)</option>
                </select>
                <select id="dev-profissional" title="Profissional ou ACS responsável"></select>
                <input type="text" id="dev-telefone" placeholder="Telefone do paciente">
              </div>
              <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:center;">
                <input type="text" id="dev-obs" style="flex:1;min-width:240px;" placeholder="O que precisa verificar/corrigir (ex: confirmar endereço/mudança c/ ACS ou procedimento correto c/ médico)...">
                <label style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:800;color:#1e3a8a;cursor:pointer;">
                  <input type="checkbox" id="dev-enviar-chat" checked> 💬 Avisar no Chat Interno
                </label>
                <button type="button" class="btn btn-primary btn-sm" onclick="salvarNovaDevolucaoSisreg()">➕ Registrar e Direcionar</button>
              </div>
            </div>

            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:12px 0 8px;flex-wrap:wrap;">
              <div style="display:flex;gap:5px;flex-wrap:wrap;">
                <button type="button" class="btn-filter ${_sisregDevFiltro === 'abertas' ? 'active' : ''}" id="dev-flt-abertas" onclick="filtrarDevolucoesSisreg('abertas')">📋 Abertas</button>
                <button type="button" class="btn-filter ${_sisregDevFiltro === 'pendente' ? 'active' : ''}" id="dev-flt-pend" onclick="filtrarDevolucoesSisreg('pendente')">⏳ Pendentes</button>
                <button type="button" class="btn-filter ${_sisregDevFiltro === 'respondida' ? 'active' : ''}" id="dev-flt-resp" onclick="filtrarDevolucoesSisreg('respondida')">💬 Respondidas</button>
                <button type="button" class="btn-filter ${_sisregDevFiltro === 'corrigida' ? 'active' : ''}" id="dev-flt-corr" onclick="filtrarDevolucoesSisreg('corrigida')">✅ Corrigidas</button>
                <button type="button" class="btn-filter ${_sisregDevFiltro === 'todas' ? 'active' : ''}" id="dev-flt-todas" onclick="filtrarDevolucoesSisreg('todas')">🗂️ Todas</button>
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                <select id="dev-flt-setor" onchange="onDevFiltroListaChange()" style="padding:5px 8px;border:1.5px solid #cbd5e1;border-radius:8px;font-size:12px;font-weight:700;background:#fff;color:#0f172a;">
                  <option value="todos">Todos os Setores</option>
                  <option value="Médico">🩺 Médico</option>
                  <option value="Enfermagem">👩‍⚕️ Enfermagem</option>
                  <option value="Odontologia">🦷 Odontologia</option>
                  <option value="ACS">🧡 ACS</option>
                </select>
                <input type="text" id="dev-flt-busca" oninput="onDevFiltroListaChange()" placeholder="🔎 Buscar paciente, protocolo..." style="padding:5px 9px;border:1.5px solid #cbd5e1;border-radius:8px;font-size:12px;font-weight:700;min-width:170px;">
                <button type="button" class="btn btn-sm" style="background:#dc2626;color:#fff;border:none;font-weight:800;" onclick="exportarDevolucoesSisregPDF()" title="Imprimir/baixar lista filtrada em PDF">📄 Imprimir PDF</button>
                <button type="button" class="btn btn-outline btn-sm" onclick="carregarDevolucoesSisreg()">🔄 Atualizar</button>
              </div>
            </div>
            <div id="sisreg-dev-lista" class="sisreg-dev-lista"></div>
          </div>
        </div>
      </div>
    `;

    inicializarPanZoomCopiloto();
    renderEstadoFormularioCopiloto();
    onDevSetorDestinoChange();
  }

  function abrirModalPreviaRegulacao(aba = 'leitor') {
    garantirModalPreviaRegulacaoMontado();
    const modal = document.getElementById('modal-previa-regulacao');
    if (!modal) return;
    trocarAbaCopilotoRegulacao(aba || 'leitor');
    modal.classList.add('show');
    inicializarPanZoomCopiloto();
    garantirCatalogoSisregCarregado().then(() => {
      executarBuscaManualSisreg();
      renderSugestoesCopiloto();
    });
    carregarDevolucoesSisreg();
    renderVisualizadorCopiloto();
  }

  function fecharModalPreviaRegulacao() {
    document.getElementById('modal-previa-regulacao')?.classList.remove('show');
    revogarCopilotoPdfBlobUrl();
  }

  function toggleCorpoCopilotoRegulacao() {
    abrirModalPreviaRegulacao(_sisregAbaAtiva || 'leitor');
  }

  function trocarAbaCopilotoRegulacao(aba) {
    _sisregAbaAtiva = aba;
    ['leitor', 'busca', 'devolucoes'].forEach(k => {
      document.getElementById(`sisreg-tab-${k}`)?.classList.toggle('active', k === aba);
      const pane = document.getElementById(`sisreg-pane-${k}`);
      if (pane) pane.style.display = k === aba ? 'block' : 'none';
    });
    if (aba === 'busca') {
      garantirCatalogoSisregCarregado().then(() => {
        executarBuscaManualSisreg();
        document.getElementById('sisreg-busca-input')?.focus();
      });
    } else if (aba === 'devolucoes') {
      carregarDevolucoesSisreg();
    }
  }

  // ===== ZOOM / PAN (GARRINHA) DO COPILOTO =====
  function aplicarTransformCopilotoImg() {
    const img = document.getElementById('sisreg-stage-img');
    if (img) {
      img.style.transform = `translate(${_copilotoState.panX}px, ${_copilotoState.panY}px) scale(${_copilotoState.zoom}) rotate(${_copilotoState.rot}deg)`;
    }
    const lbl = document.getElementById('sisreg-zoom-label');
    if (lbl) lbl.textContent = `${Math.round(_copilotoState.zoom * 100)}%`;
  }

  function zoomCopilotoImg(delta) {
    _copilotoState.zoom = Math.max(0.5, Math.min(4.5, Number((_copilotoState.zoom + delta).toFixed(2))));
    aplicarTransformCopilotoImg();
  }

  function girarCopilotoImg() {
    _copilotoState.rot = (_copilotoState.rot + 90) % 360;
    aplicarTransformCopilotoImg();
  }

  function resetCopilotoImgView() {
    _copilotoState.zoom = 1;
    _copilotoState.rot = 0;
    _copilotoState.panX = 0;
    _copilotoState.panY = 0;
    aplicarTransformCopilotoImg();
  }

  function inicializarPanZoomCopiloto() {
    if (typeof window.initPreviaPanZoom !== 'function') return;
    window.initPreviaPanZoom(
      'sisreg-img-stage',
      'sisreg-stage-img',
      () => _copilotoState,
      (patch) => { Object.assign(_copilotoState, patch); },
      aplicarTransformCopilotoImg
    );
  }

  function renderVisualizadorCopiloto() {
    const imgEl = document.getElementById('sisreg-stage-img');
    const pdfFrame = document.getElementById('sisreg-stage-pdf-iframe');
    const controlsEl = document.getElementById('sisreg-img-controls');
    const dlEl = document.getElementById('sisreg-btn-download-ativo');
    const emptyEl = document.getElementById('sisreg-stage-empty');
    const navEl = document.getElementById('sisreg-img-nav');
    const cntEl = document.getElementById('sisreg-img-counter');
    const strip = document.getElementById('sisreg-thumbs-strip');
    if (!imgEl || !emptyEl) return;

    resetCopilotoImgView();
    revogarCopilotoPdfBlobUrl();

    const total = _copilotoState.anexos.length;
    if (total === 0) {
      imgEl.src = '';
      imgEl.style.display = 'none';
      if (pdfFrame) { pdfFrame.src = 'about:blank'; pdfFrame.style.display = 'none'; }
      if (controlsEl) controlsEl.style.display = 'none';
      if (dlEl) dlEl.style.display = 'none';
      emptyEl.style.display = 'flex';
      if (navEl) navEl.style.display = 'none';
      if (strip) { strip.style.display = 'none'; strip.innerHTML = ''; }
      return;
    }

    if (_copilotoState.anexoIdx >= total) _copilotoState.anexoIdx = total - 1;
    const ativo = _copilotoState.anexos[_copilotoState.anexoIdx];
    const ehPdf = isDataUrlPdfSisreg(ativo?.imagem_base64, ativo?.mime_type);

    emptyEl.style.display = 'none';
    if (ehPdf && ativo?.imagem_base64) {
      imgEl.src = '';
      imgEl.style.display = 'none';
      if (controlsEl) controlsEl.style.display = 'flex';
      controlsEl?.querySelectorAll('button, .previa-zoom-pill, .previa-pan-hint').forEach(el => {
        el.style.display = 'none';
      });
      if (dlEl) {
        dlEl.href = ativo.imagem_base64;
        dlEl.download = ativo.nome_arquivo || `documento-sisreg-${_copilotoState.anexoIdx + 1}.pdf`;
        dlEl.style.display = 'inline-flex';
      }
      if (pdfFrame) {
        const blobUrl = criarBlobUrlPdfSisreg(ativo.imagem_base64);
        _copilotoPdfBlobUrl = blobUrl;
        pdfFrame.src = blobUrl || ativo.imagem_base64;
        pdfFrame.style.display = 'block';
      }
    } else if (ativo?.imagem_base64) {
      if (pdfFrame) { pdfFrame.src = 'about:blank'; pdfFrame.style.display = 'none'; }
      controlsEl?.querySelectorAll('button, .previa-zoom-pill, .previa-pan-hint').forEach(el => {
        el.style.display = '';
      });
      if (controlsEl) controlsEl.style.display = 'flex';
      imgEl.src = ativo.imagem_base64;
      imgEl.style.display = 'block';
      if (dlEl) {
        dlEl.href = ativo.imagem_base64;
        dlEl.download = ativo.nome_arquivo || `ficha-sisreg-${_copilotoState.anexoIdx + 1}.jpg`;
        dlEl.style.display = 'inline-flex';
      }
    }

    if (navEl) {
      navEl.style.display = total > 1 ? 'flex' : 'none';
      if (cntEl) cntEl.textContent = `Arquivo ${_copilotoState.anexoIdx + 1} de ${total}${ehPdf ? ' · 📄 PDF' : ''}`;
    }
    if (strip) {
      if (total > 1) {
        strip.style.display = 'flex';
        strip.innerHTML = _copilotoState.anexos.map((a, idx) => {
          const isP = isDataUrlPdfSisreg(a?.imagem_base64, a?.mime_type);
          const thumbBody = isP
            ? `<div class="pr-thumb-pdf-mini">📄</div>`
            : `<img src="${a.imagem_base64}" alt="Arquivo ${idx + 1}">`;
          return `<button type="button" class="vp-thumb-btn${idx === _copilotoState.anexoIdx ? ' active' : ''}" onclick="selecionarFotoCopiloto(${idx})">
            ${thumbBody}
            <span>${isP ? '📄' : '📷'} ${idx + 1}</span>
          </button>`;
        }).join('');
      } else {
        strip.style.display = 'none';
        strip.innerHTML = '';
      }
    }
  }

  function navegarFotoCopiloto(delta) {
    const t = _copilotoState.anexos.length;
    if (t <= 1) return;
    _copilotoState.anexoIdx = (_copilotoState.anexoIdx + delta + t) % t;
    renderVisualizadorCopiloto();
  }

  function selecionarFotoCopiloto(idx) {
    if (idx < 0 || idx >= _copilotoState.anexos.length) return;
    _copilotoState.anexoIdx = idx;
    renderVisualizadorCopiloto();
  }

  // ===== PROCESSAR ARQUIVOS (FOTOS / PDF) =====
  async function processarArquivosCopilotoSisreg(fileList) {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;
    abrirModalPreviaRegulacao('leitor');

    const statusEl = document.getElementById('sisreg-ocr-status');
    let anexosAdicionados = 0;

    for (let i = 0; i < files.length && _copilotoState.anexos.length < 6; i++) {
      const f = files[i];
      const ehPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
      const ehImg = !f.type || f.type.startsWith('image/');
      if (!ehPdf && !ehImg) continue;

      try {
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.className = 'pr-status-box loading';
          statusEl.textContent = ehPdf
            ? '⏳ Lendo PDF... aguarde alguns segundos.'
            : (files.length > 1
              ? `⏳ Analisando arquivo ${i + 1} de ${files.length}...`
              : '⏳ Analisando documento e cruzando com o SISREG...');
        }
        const b64 = ehPdf ? await lerPdfBase64(f) : await comprimirImagemSisreg(f);
        const anexoObj = {
          id: `sr_${Date.now().toString(36)}_${i + 1}`,
          categoria: 'encaminhamento',
          rotulo: ehPdf ? 'PDF' : null,
          imagem_base64: b64,
          ocr: null
        };
        if (ehPdf) {
          anexoObj.mime_type = 'application/pdf';
          anexoObj.nome_arquivo = f.name;
        }
        _copilotoState.anexos.push(anexoObj);
        _copilotoState.anexoIdx = _copilotoState.anexos.length - 1;
        renderVisualizadorCopiloto();
        atualizarPillPacienteVinculado();
        await executarAnaliseIaCopiloto(b64, statusEl, anexosAdicionados > 0);
        anexosAdicionados++;
      } catch (err) {
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.className = 'pr-status-box warn';
          statusEl.textContent = `⚠️ ${err.message || 'Erro ao processar arquivo.'}`;
        }
      }
    }
    if (anexosAdicionados === 0 && typeof showToast === 'function') {
      showToast('Envie fotos (JPG/PNG) ou PDFs até 2 MB.', true);
    }
  }

  function mesclarDadosSisreg(atual, novo, acumular) {
    const out = { ...atual };
    const chavesTexto = [
      'tipo_arquivo', 'codigo_solicitacao', 'paciente_nome', 'paciente_cns',
      'paciente_dn', 'paciente_sexo', 'paciente_mae', 'paciente_telefone',
      'paciente_endereco', 'paciente_bairro', 'paciente_cep', 'paciente_municipio',
      'paciente_uf', 'tipo_vaga', 'risco', 'especialidade_ou_exame',
      'hipotese_diagnostica', 'cid10', 'medico_solicitante', 'crm_conselho', 'data_solicitacao'
    ];
    chavesTexto.forEach(k => {
      if (novo[k] && (!acumular || !out[k])) out[k] = novo[k];
    });
    if (typeof novo.tem_assinatura_carimbo === 'boolean') {
      out.tem_assinatura_carimbo = novo.tem_assinatura_carimbo;
    }
    if (novo.confianca !== null && novo.confianca !== undefined) out.confianca = novo.confianca;

    const listaExist = Array.isArray(out.procedimentos_pedidos) ? out.procedimentos_pedidos.slice() : [];
    const novosProcs = Array.isArray(novo.procedimentos_pedidos) ? novo.procedimentos_pedidos : [];
    if (!acumular && novosProcs.length > 0) {
      out.procedimentos_pedidos = novosProcs;
    } else {
      novosProcs.forEach(np => {
        if (np && !listaExist.some(x => normSisregFront(x) === normSisregFront(np))) {
          listaExist.push(np);
        }
      });
      out.procedimentos_pedidos = listaExist;
    }

    const unirObs = (a, b) => {
      const sa = String(a || '').trim();
      const sb = String(b || '').trim();
      if (!sb) return sa;
      if (!sa || !acumular) return sb;
      if (normSisregFront(sa).includes(normSisregFront(sb))) return sa;
      return `${sa}\n${sb}`;
    };
    out.observacoes_original = unirObs(out.observacoes_original, novo.observacoes_original);
    out.observacoes_revisada = unirObs(out.observacoes_revisada, novo.observacoes_revisada);

    const alerts = new Set([...(acumular ? (out.alertas_digitacao || []) : []), ...(novo.alertas_digitacao || [])]);
    out.alertas_digitacao = Array.from(alerts);
    return out;
  }

  async function executarAnaliseIaCopiloto(base64Str, statusEl, acumular = false) {
    _copilotoState.analisando = true;
    try {
      const res = await fetch(`${getApiUrlBase()}/sisreg/analisar-ficha`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arquivo_base64: base64Str })
      });
      const data = await res.json();
      if (data.ok && data.dados) {
        _copilotoState.dados = mesclarDadosSisreg(_copilotoState.dados, data.dados, acumular);
        if (!acumular) _copilotoState.telefoneConferido = false;
        _copilotoState.sugestoes = Array.isArray(data.sugestoes_procedimentos) ? data.sugestoes_procedimentos : [];
        incrementarContadorLidasHoje();
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.className = 'pr-status-box ok';
          statusEl.textContent = '✅ Leitura concluída! Confira os alertas, o telefone e copie as observações para o SISREG.';
        }
        renderEstadoFormularioCopiloto();
        rebuscarProcedimentosCopiloto();
      } else {
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.className = 'pr-status-box warn';
          statusEl.textContent = `⚠️ ${data.error || 'Leitura automática indisponível — imagem mantida para leitura manual.'}`;
        }
      }
    } catch (_) {
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.className = 'pr-status-box warn';
        statusEl.textContent = '⚠️ Falha de conexão na leitura automática. A foto permanece visível ao lado.';
      }
    } finally {
      _copilotoState.analisando = false;
    }
  }

  async function reanalisarAnexoAtivoCopiloto() {
    const statusEl = document.getElementById('sisreg-ocr-status');
    const b64 = _copilotoState.anexos[_copilotoState.anexoIdx]?.imagem_base64 || _copilotoState.pdfBase64;
    if (!b64) {
      if (typeof showToast === 'function') showToast('Anexe uma foto ou PDF primeiro.', true);
      return;
    }
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.className = 'pr-status-box loading';
      statusEl.textContent = '⏳ Reanalisando prévia...';
    }
    await executarAnaliseIaCopiloto(b64, statusEl, false);
  }

  function limparFichaCopilotoSisreg() {
    _copilotoState.patientId = null;
    _copilotoState.patientNomeFila = '';
    _copilotoState.anexos = [];
    _copilotoState.anexoIdx = 0;
    _copilotoState.arquivoTipo = null;
    _copilotoState.pdfBase64 = null;
    _copilotoState.pdfNome = '';
    _copilotoState.verOriginal = false;
    _copilotoState.telefoneConferido = false;
    _copilotoState.dados = criarDadosVaziosSisreg();
    _copilotoState.sugestoes = [];
    const statusEl = document.getElementById('sisreg-ocr-status');
    if (statusEl) statusEl.style.display = 'none';
    renderEstadoFormularioCopiloto();
  }

  function atualizarPillPacienteVinculado() {
    const pill = document.getElementById('sisreg-pac-vinculado-pill');
    const nomeEl = document.getElementById('sisreg-pac-vinculado-nome');
    const btnSalvar = document.getElementById('sisreg-btn-salvar-fila');
    const btnReler = document.getElementById('sisreg-btn-reanalisar-vinculado');
    if (!pill) return;
    if (_copilotoState.patientId) {
      pill.style.display = 'inline-flex';
      if (nomeEl) nomeEl.textContent = _copilotoState.patientNomeFila || `ID ${_copilotoState.patientId}`;
      if (btnSalvar) btnSalvar.style.display = _copilotoState.anexos.length > 0 ? 'inline-flex' : 'none';
      if (btnReler) btnReler.style.display = (_copilotoState.anexos.length > 0 || _copilotoState.pdfBase64) ? 'inline-flex' : 'none';
    } else {
      pill.style.display = 'none';
    }
  }

  function desvincularPacienteCopiloto() {
    _copilotoState.patientId = null;
    _copilotoState.patientNomeFila = '';
    atualizarPillPacienteVinculado();
  }

  function renderEstadoFormularioCopiloto() {
    const d = _copilotoState.dados;
    const setVal = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.value = v || '';
    };
    setVal('sr-nome', d.paciente_nome);
    setVal('sr-cns', d.paciente_cns);
    setVal('sr-dn', d.paciente_dn);
    setVal('sr-mae', d.paciente_mae);
    setVal('sr-telefone', d.paciente_telefone);
    setVal('sr-endereco', d.paciente_endereco);
    setVal('sr-municipio', d.paciente_municipio);
    setVal('sr-uf', d.paciente_uf);
    setVal('sr-cep', d.paciente_cep);
    setVal('sr-especialidade', d.especialidade_ou_exame);
    setVal('sr-cid', d.cid10);
    setVal('sr-tipo-vaga', d.tipo_vaga);
    setVal('sr-risco', d.risco);
    setVal('sr-hipotese', d.hipotese_diagnostica);
    setVal('sr-solicitante', [d.medico_solicitante, d.crm_conselho].filter(Boolean).join(' · '));
    setVal('sr-protocolo', d.codigo_solicitacao);

    const obsTexto = _copilotoState.verOriginal
      ? (d.observacoes_original || '')
      : formatarObservacaoFront(d.observacoes_revisada || d.observacoes_original || '', _copilotoState.semAcentoMaiusculo);
    setVal('sr-observacoes', obsTexto);

    const btnOrig = document.getElementById('sr-btn-toggle-orig');
    if (btnOrig) {
      const temDiff = d.observacoes_original && d.observacoes_revisada && d.observacoes_original !== d.observacoes_revisada;
      btnOrig.style.display = temDiff ? 'inline-flex' : 'none';
      btnOrig.textContent = _copilotoState.verOriginal ? 'Ver revisada' : 'Ver original';
    }

    const chkTel = document.getElementById('sr-tel-conferido');
    if (chkTel) chkTel.checked = Boolean(_copilotoState.telefoneConferido);

    const chkMai = document.getElementById('sr-chk-maiusc');
    if (chkMai) chkMai.checked = Boolean(_copilotoState.semAcentoMaiusculo);

    const confBadge = document.getElementById('sr-confianca-badge');
    if (confBadge) {
      if (Number.isFinite(Number(d.confianca)) && Number(d.confianca) > 0) {
        confBadge.style.display = 'inline-flex';
        confBadge.textContent = `Leitura ${d.confianca}%`;
      } else {
        confBadge.style.display = 'none';
      }
    }

    renderVisualizadorCopiloto();
    atualizarPillPacienteVinculado();
    atualizarValidacoesAoVivoCopiloto();
  }

  function onCampoSisregAlterado(campo, valor) {
    _copilotoState.dados[campo] = valor;
    if (campo === 'observacoes_revisada') {
      _copilotoState.verOriginal = false;
    }
    if (campo === 'especialidade_ou_exame' || campo === 'paciente_dn' || campo === 'tipo_vaga') {
      rebuscarProcedimentosCopiloto();
    }
    atualizarValidacoesAoVivoCopiloto();
  }

  function onInputTelefoneSisreg(val) {
    const fmt = formatarTelefoneMask(val);
    const inp = document.getElementById('sr-telefone');
    if (inp && fmt !== val) inp.value = fmt;
    _copilotoState.dados.paciente_telefone = fmt || val;
    atualizarValidacoesAoVivoCopiloto();
  }

  function onToggleTelConferidoSisreg(checked) {
    _copilotoState.telefoneConferido = Boolean(checked);
    atualizarValidacoesAoVivoCopiloto();
  }

  function onToggleMaiusculasObs(checked) {
    _copilotoState.semAcentoMaiusculo = Boolean(checked);
    _copilotoState.verOriginal = false;
    const base = _copilotoState.dados.observacoes_revisada || _copilotoState.dados.observacoes_original || '';
    const el = document.getElementById('sr-observacoes');
    if (el) el.value = formatarObservacaoFront(base, _copilotoState.semAcentoMaiusculo);
    atualizarDestaqueConferirObsSisreg();
  }

  function alternarTextoOriginalObsSisreg() {
    _copilotoState.verOriginal = !_copilotoState.verOriginal;
    const d = _copilotoState.dados;
    const el = document.getElementById('sr-observacoes');
    const btn = document.getElementById('sr-btn-toggle-orig');
    if (el) {
      el.value = _copilotoState.verOriginal
        ? (d.observacoes_original || '')
        : formatarObservacaoFront(d.observacoes_revisada || d.observacoes_original || '', _copilotoState.semAcentoMaiusculo);
    }
    if (btn) btn.textContent = _copilotoState.verOriginal ? 'Ver revisada' : 'Ver original';
    atualizarDestaqueConferirObsSisreg();
  }

  const REGEX_CONFERIR_SISREG = /\[CONFERIR[^\]]*\]/gi;

  function extrairTrechosConferirSisreg(texto) {
    const s = String(texto || '');
    const m = s.match(REGEX_CONFERIR_SISREG);
    return m ? m.slice() : [];
  }

  function renderizarTextoComConferirNegrito(texto) {
    const s = String(texto || '');
    let out = '';
    let last = 0;
    const re = new RegExp(REGEX_CONFERIR_SISREG.source, 'gi');
    let m;
    while ((m = re.exec(s)) !== null) {
      if (m.index > last) {
        out += escSisreg(s.slice(last, m.index));
      }
      out += `<mark class="sisreg-conferir-mark"><strong>${escSisreg(m[0])}</strong></mark>`;
      last = m.index + m[0].length;
    }
    if (last < s.length) {
      out += escSisreg(s.slice(last));
    }
    return out.replace(/\n/g, '<br>');
  }

  function focarTrechoConferirSisreg(textareaId, indice) {
    const ta = document.getElementById(textareaId);
    if (!ta) return;
    const txt = String(ta.value || '');
    const re = new RegExp(REGEX_CONFERIR_SISREG.source, 'gi');
    let m;
    let cur = 0;
    const targetIdx = Number(indice) || 0;
    while ((m = re.exec(txt)) !== null) {
      if (cur === targetIdx) {
        ta.focus();
        ta.setSelectionRange(m.index, m.index + m[0].length);
        return;
      }
      cur++;
    }
    ta.focus();
  }

  function removerMarcacoesConferirSisreg(textareaId, isMedico) {
    const ta = document.getElementById(textareaId);
    if (!ta) return;
    const trechos = extrairTrechosConferirSisreg(ta.value);
    if (!trechos.length) return;
    if (!confirm(`Remover ${trechos.length} marcação(ões) [CONFERIR: ...] do texto?\n\nFaça isso somente após conferir a informação correta para o paciente.`)) {
      return;
    }
    const limpo = String(ta.value || '')
      .replace(REGEX_CONFERIR_SISREG, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([.,;:])/g, '$1')
      .replace(/^\s+|\s+$/gm, '')
      .trim();
    ta.value = limpo;
    if (isMedico) {
      _modalMedState.dados.observacoes_revisada = limpo;
      atualizarDestaqueConferirModalMedico();
    } else {
      onCampoSisregAlterado('observacoes_revisada', limpo);
    }
    if (typeof showToast === 'function') {
      showToast('🧹 Marcações [CONFERIR] removidas. Revise o texto final antes de copiar!');
    }
  }

  function atualizarPainelConferirTextarea(textareaId, boxId, isMedico) {
    const ta = document.getElementById(textareaId);
    const box = document.getElementById(boxId);
    if (!ta || !box) return;
    const texto = String(ta.value || '');
    const trechos = extrairTrechosConferirSisreg(texto);

    if (!trechos.length) {
      ta.classList.remove('sisreg-textarea-alerta-conferir');
      box.style.display = 'none';
      box.innerHTML = '';
      return;
    }

    ta.classList.add('sisreg-textarea-alerta-conferir');
    const chipsHtml = trechos.map((t, idx) =>
      `<button type="button" class="sisreg-conferir-chip" onclick="focarTrechoConferirSisreg('${textareaId}', ${idx})" title="Clique para selecionar este trecho no campo abaixo">✏️ <strong>${escSisreg(t)}</strong></button>`
    ).join('');

    box.style.display = 'block';
    box.innerHTML = `
      <div class="sisreg-conferir-head">
        <span>⚠️ ${trechos.length} trecho(s) em <strong>NEGRITO</strong> para conferir (NÃO copiar assim p/ o SISREG)</span>
        <button type="button" class="sisreg-mini-link" style="border-color:#fca5a5;color:#991b1b;" onclick="removerMarcacoesConferirSisreg('${textareaId}', ${Boolean(isMedico)})">🧹 Limpar [CONFERIR]</button>
      </div>
      <div class="sisreg-conferir-preview">${renderizarTextoComConferirNegrito(texto)}</div>
      <div class="sisreg-conferir-chips">${chipsHtml}</div>
    `;
  }

  function atualizarDestaqueConferirObsSisreg() {
    atualizarPainelConferirTextarea('sr-observacoes', 'sr-obs-conferir-box', false);
  }

  function atualizarDestaqueConferirModalMedico() {
    atualizarPainelConferirTextarea('sm-pac-obs', 'sm-obs-conferir-box', true);
  }

  function confirmarCopiaComConferir(texto, textareaId) {
    const trechos = extrairTrechosConferirSisreg(texto);
    if (!trechos.length) return true;
    const resumo = trechos.slice(0, 3).map(t => `• ${t}`).join('\n');
    const ok = confirm(
      `⚠️ ATENÇÃO — TRECHO NÃO CONFERIDO NO TEXTO!\n\n` +
      `Ainda existe(m) ${trechos.length} marcação(ões) [CONFERIR] nas observações:\n${resumo}\n\n` +
      `Clique em "Cancelar" para revisar/corrigir antes de colar no SISREG, ou "OK" se quiser copiar mesmo assim.`
    );
    if (!ok) {
      focarTrechoConferirSisreg(textareaId, 0);
      return false;
    }
    return true;
  }

  function copiarTelefoneSoDigitos() {
    const tel = validarTelefoneFront(document.getElementById('sr-telefone')?.value || '');
    copiarTextoSisreg(tel.digits || '', 'Telefone (só dígitos)');
  }

  function copiarCampoSisreg(id, label) {
    const v = document.getElementById(id)?.value?.trim() || '';
    copiarTextoSisreg(v, label);
  }

  function copiarObservacaoSisreg(blocoCompleto) {
    const obsTxt = document.getElementById('sr-observacoes')?.value?.trim() || '';
    if (!confirmarCopiaComConferir(obsTxt, 'sr-observacoes')) return;
    if (!blocoCompleto) {
      copiarTextoSisreg(obsTxt, 'Observações Clínicas');
      return;
    }
    const hip = document.getElementById('sr-hipotese')?.value?.trim() || '';
    const cid = document.getElementById('sr-cid')?.value?.trim() || '';
    const partes = [];
    if (hip) partes.push(`HIPOTESE: ${hip}`);
    if (cid) partes.push(`CID: ${cid}`);
    if (obsTxt) partes.push(obsTxt);
    let finalTxt = partes.join(' | ');
    if (_copilotoState.semAcentoMaiusculo) {
      finalTxt = formatarObservacaoFront(finalTxt, true);
    }
    copiarTextoSisreg(finalTxt, 'Bloco Clínico Completo');
  }

  function copiarObsModalMedicoSisreg() {
    const obsTxt = document.getElementById('sm-pac-obs')?.value?.trim() || '';
    if (!confirmarCopiaComConferir(obsTxt, 'sm-pac-obs')) return;
    copiarTextoSisreg(obsTxt, 'Observações Clínicas');
  }

  function atualizarValidacoesAoVivoCopiloto() {
    atualizarDestaqueConferirObsSisreg();
    const d = _copilotoState.dados;
    const cnsInfo = validarCnsFront(d.paciente_cns);
    const telInfo = validarTelefoneFront(d.paciente_telefone);
    const idade = calcularIdadeFront(d.paciente_dn);
    const endInfo = verificarEnderecoRecifeFront({
      municipio: d.paciente_municipio,
      uf: d.paciente_uf,
      cep: d.paciente_cep,
      endereco: d.paciente_endereco
    });

    const cnsBadge = document.getElementById('sr-cns-badge');
    if (cnsBadge) {
      if (cnsInfo.valido === true) {
        cnsBadge.textContent = '✅ Válido';
        cnsBadge.className = 'sisreg-inline-badge ok';
      } else if (cnsInfo.valido === false) {
        cnsBadge.textContent = `❌ ${cnsInfo.motivo}`;
        cnsBadge.className = 'sisreg-inline-badge err';
      } else {
        cnsBadge.textContent = '';
        cnsBadge.className = 'sisreg-inline-badge';
      }
    }

    const idBadge = document.getElementById('sr-idade-badge');
    if (idBadge) {
      idBadge.textContent = idade !== null ? `(${idade} anos)` : '';
    }

    const telBadge = document.getElementById('sisreg-tel-status-badge');
    if (telBadge) {
      if (telInfo.valido && _copilotoState.telefoneConferido) {
        telBadge.textContent = '✅ Conferido';
        telBadge.className = 'sisreg-pill-mini ok';
      } else if (telInfo.valido && telInfo.celular) {
        telBadge.textContent = '📱 Celular OK — confirme c/ usuário';
        telBadge.className = 'sisreg-pill-mini info';
      } else if (telInfo.valido) {
        telBadge.textContent = '⚠️ Telefone fixo';
        telBadge.className = 'sisreg-pill-mini warn';
      } else {
        telBadge.textContent = '🚨 Atualizar telefone';
        telBadge.className = 'sisreg-pill-mini err';
      }
    }

    const alertsBox = document.getElementById('sisreg-alertas-dinamicos');
    if (alertsBox) {
      const banners = [];
      if (endInfo.status === 'fora_recife') {
        banners.push(`
          <div class="sisreg-alert-banner danger">
            <div>
              <strong>${escSisreg(endInfo.alerta)}</strong><br>
              <span>Confirme comprovante de residência antes de enviar para evitar devolução da Central.</span>
            </div>
            <button type="button" class="btn btn-sm" style="background:#fff;color:#991b1b;font-weight:900;white-space:nowrap;" onclick="abrirDeclResidenciaDoCopiloto()">🏠 Declaração de Residência</button>
          </div>
        `);
      }
      if (cnsInfo.valido === false) {
        banners.push(`<div class="sisreg-alert-banner danger"><span>🚫 <strong>CNS inválido:</strong> ${escSisreg(cnsInfo.motivo)}</span></div>`);
      }
      if (d.tem_assinatura_carimbo === false) {
        banners.push(`<div class="sisreg-alert-banner warn"><span>⚠️ <strong>Assinatura/Carimbo:</strong> não identificado claramente na ficha — confira antes de protocolar.</span></div>`);
      }
      const obsAtual = d.observacoes_revisada || '';
      if (obsAtual.includes('[CONFERIR')) {
        banners.push(`<div class="sisreg-alert-banner warn"><span>✍️ <strong>Caligrafia/Digitação:</strong> há trecho marcado com <code>[CONFERIR: ...]</code> na observação. Revise antes de colar no SISREG!</span></div>`);
      }
      if (Array.isArray(d.alertas_digitacao) && d.alertas_digitacao.length > 0) {
        banners.push(`<div class="sisreg-alert-banner info"><span>🧹 <strong>Revisão automática de digitação:</strong> ${escSisreg(d.alertas_digitacao.join(' · '))}</span></div>`);
      }
      alertsBox.innerHTML = banners.join('');
    }

    const checkBar = document.getElementById('sisreg-checklist-rodape');
    if (checkBar) {
      const temObs = Boolean((d.observacoes_revisada || d.observacoes_original || '').trim()) && !(d.observacoes_revisada || '').includes('[CONFERIR');
      const temProcMatch = (_copilotoState.sugestoes || []).some(s => Array.isArray(s.resultados) && s.resultados.length > 0);
      const chip = (ok, label) => `<span class="sisreg-chk-pill ${ok ? 'ok' : 'pend'}">${ok ? '✅' : '⚠️'} ${label}</span>`;
      checkBar.innerHTML = `
        <div class="sisreg-chk-pills">
          ${chip(cnsInfo.valido === true, 'CNS')}
          ${chip(telInfo.valido && _copilotoState.telefoneConferido, 'Telefone')}
          ${chip(endInfo.status === 'ok', 'Recife-PE')}
          ${chip(Boolean(d.cid10), 'CID-10')}
          ${chip(temObs, 'Observação')}
          ${chip(temProcMatch, 'Cód. SISREG')}
        </div>
        <button type="button" class="btn btn-sm" style="background:#fff7ed;color:#9a3412;border:1px solid #fdba74;font-weight:800;" onclick="preencherDevolucaoDaFichaAtual()">↩️ Registrar Devolução</button>
      `;
    }
  }

  function abrirDeclResidenciaDoCopiloto() {
    if (typeof abrirFormularioOficial !== 'function') return;
    const d = _copilotoState.dados;
    abrirFormularioOficial('declaracao-residencia', {
      modo: 'preencher',
      setor: 'Recepção',
      paciente: { nome: d.paciente_nome || '' },
      previa: {
        paciente_nome_ocr: d.paciente_nome || '',
        paciente_cns: d.paciente_cns || '',
        dados_extras: {
          paciente_endereco: d.paciente_endereco || '',
          paciente_telefone: d.paciente_telefone || ''
        }
      }
    });
  }

  async function rebuscarProcedimentosCopiloto() {
    await garantirCatalogoSisregCarregado();
    const d = _copilotoState.dados;
    const idade = calcularIdadeFront(d.paciente_dn);
    const termos = [];
    if (d.especialidade_ou_exame && d.especialidade_ou_exame.trim()) termos.push(d.especialidade_ou_exame.trim());
    (d.procedimentos_pedidos || []).forEach(p => {
      if (p && !termos.some(t => normSisregFront(t) === normSisregFront(p))) termos.push(p);
    });
    _copilotoState.sugestoes = termos.map(termo => ({
      termo,
      resultados: buscarProcedimentosFront(termo, {
        idade,
        tipoVaga: d.tipo_vaga || null,
        limite: 5
      })
    }));
    renderSugestoesCopiloto();
    atualizarValidacoesAoVivoCopiloto();
  }

  function renderSugestoesCopiloto() {
    const box = document.getElementById('sisreg-proc-sugestoes');
    if (!box) return;
    const sugs = _copilotoState.sugestoes || [];
    if (sugs.length === 0) {
      box.innerHTML = `<div class="sisreg-muted">Informe a especialidade/exame ou anexe a foto da ficha para localizar o código e o grupo exato no SISREG.</div>`;
      return;
    }

    box.innerHTML = sugs.map(grupo => {
      const lista = grupo.resultados || [];
      if (lista.length === 0) {
        return `
          <div class="sisreg-match-miss">
            <div>
              <strong>⚠️ "${escSisreg(grupo.termo)}"</strong> não encontrado na tabela local.<br>
              <span>Procure o <strong>${escSisreg(SISREG_CONTATO_FALLBACK)}</strong> ou tente outro termo na busca.</span>
            </div>
            <button type="button" class="btn btn-outline btn-sm" onclick="abrirBuscaComTermo('${encodeURIComponent(grupo.termo)}')">🔎 Refinar</button>
          </div>
        `;
      }
      const itensHtml = lista.slice(0, 4).map((p, idx) => `
        <div class="sisreg-match-item ${idx === 0 ? 'top' : ''}">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            <div>
              <span class="sisreg-code-badge">${escSisreg(p.code || 'S/CÓD')}</span>
              <span class="sisreg-type-tag ${normSisregFront(p.type)}">${escSisreg(p.type)}</span>
              <strong style="font-size:12.5px;color:#0f172a;">${escSisreg(p.name)}</strong>
            </div>
            <div style="display:flex;gap:4px;">
              <button type="button" class="btn btn-primary btn-sm" onclick="copiarProcedimentoByInfo('${encodeURIComponent(p.code || '')}','Cód. Procedimento')">📋 Cód.</button>
              <button type="button" class="btn btn-outline btn-sm" onclick="copiarProcedimentoByInfo('${encodeURIComponent(p.name || '')}','Nome do Procedimento')">📋 Nome</button>
            </div>
          </div>
          <div class="sisreg-hier-path">📍 Onde achar no SISREG: <strong>${escSisreg(p.hierarchy || 'Grupo principal')}</strong></div>
        </div>
      `).join('');
      return `
        <div style="margin-bottom:8px;">
          <div style="font-size:11px;font-weight:800;color:#475569;margin-bottom:4px;">Pedido identificado: <b style="color:#0f172a;">${escSisreg(grupo.termo)}</b></div>
          ${itensHtml}
        </div>
      `;
    }).join('');
  }

  function copiarProcedimentoByInfo(encodedTxt, label) {
    copiarTextoSisreg(decodeURIComponent(encodedTxt || ''), label);
  }

  function abrirBuscaComTermo(encodedTermo) {
    trocarAbaCopilotoRegulacao('busca');
    const inp = document.getElementById('sisreg-busca-input');
    if (inp) {
      inp.value = decodeURIComponent(encodedTermo || '');
      executarBuscaManualSisreg();
    }
  }

  function buscarAtalhoSisreg(termo) {
    const inp = document.getElementById('sisreg-busca-input');
    if (inp) {
      inp.value = termo;
      executarBuscaManualSisreg();
    }
  }

  function executarBuscaManualSisreg() {
    const tbody = document.getElementById('sisreg-busca-tbody');
    if (!tbody) return;
    const q = document.getElementById('sisreg-busca-input')?.value || '';
    const tipo = document.getElementById('sisreg-busca-tipo')?.value || 'all';
    const idade = document.getElementById('sisreg-busca-idade')?.value || '';
    const tipoVaga = document.getElementById('sisreg-busca-vaga')?.value || '';

    const lista = buscarProcedimentosFront(q, { tipo, idade, tipoVaga, limite: 300 });
    atualizarRodapeCatalogoUI(lista.length);

    if (lista.length === 0) {
      const descFiltro = q ? `para "<strong>${escSisreg(q)}</strong>"` : 'para os filtros selecionados (Idade / Tipo / 1ª Vez ou Retorno)';
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align:center;padding:22px;color:#9a3412;background:#fff7ed;font-weight:800;">
            ⚠️ Nenhum procedimento encontrado ${descFiltro}.<br>
            <span style="font-size:12px;font-weight:700;">Verifique a ortografia/sigla/filtros ou procure o <strong>${escSisreg(SISREG_CONTATO_FALLBACK)}</strong>.</span>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = lista.map(p => `
      <tr>
        <td><code class="sisreg-code-badge">${escSisreg(p.code || '—')}</code></td>
        <td style="font-weight:800;color:#0f172a;">${escSisreg(p.name)}</td>
        <td><span class="sisreg-type-tag ${normSisregFront(p.type)}">${escSisreg(p.type)}</span></td>
        <td style="font-size:12px;color:#1e3a8a;font-weight:700;">${escSisreg(p.hierarchy || '—')}</td>
        <td style="text-align:right;white-space:nowrap;">
          <button type="button" class="btn btn-primary btn-sm" onclick="copiarProcedimentoByInfo('${encodeURIComponent(p.code || '')}','Cód. Procedimento')">📋 Cód.</button>
          <button type="button" class="btn btn-outline btn-sm" onclick="copiarProcedimentoByInfo('${encodeURIComponent(p.name || '')}','Nome do Procedimento')">📋 Nome</button>
        </td>
      </tr>
    `).join('');
  }

  async function importarNovaTabelaSisreg(file) {
    if (!file) return;
    const senha = prompt(`📥 Atualizar Tabela SISREG (${file.name})\n\nDigite a senha de administrador:`);
    if (!senha) return;
    try {
      const html = await lerArquivoHtmlCatalogoText(file);
      const res = await fetch(`${getApiUrlBase()}/sisreg/catalogo/importar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senha: senha.trim(), html })
      });
      const data = await res.json();
      if (!res.ok) {
        if (typeof showToast === 'function') showToast(data.error || 'Erro ao importar tabela SISREG.', true);
        return;
      }
      await garantirCatalogoSisregCarregado(true);
      executarBuscaManualSisreg();
      rebuscarProcedimentosCopiloto();
      if (typeof showToast === 'function') {
        showToast(`✅ Tabela SISREG atualizada (${data.total} procedimentos · versão ${data.versao})!`);
      }
    } catch (err) {
      if (typeof showToast === 'function') showToast(`Erro ao importar arquivo HTML: ${err.message}`, true);
    }
  }

  // ===== VÍNCULO COM PACIENTES DA FILA (RECEPÇÃO -> REGULAÇÃO OU BALCÃO REGULAÇÃO) =====
  async function abrirPacienteNoCopilotoSisreg(patientId, nomePaciente, abrirUpload = false) {
    if (typeof showScreen === 'function') showScreen('regulacao');
    abrirModalPreviaRegulacao('leitor');

    limparFichaCopilotoSisreg();
    _copilotoState.patientId = patientId;
    _copilotoState.patientNomeFila = nomePaciente || '';
    _copilotoState.dados.paciente_nome = nomePaciente || '';
    atualizarPillPacienteVinculado();

    try {
      const r = await fetch(`${getApiUrlBase()}/patients/${patientId}/previa-receita`, { cache: 'no-store' });
      if (r.ok) {
        const pr = await r.json();
        const anexos = Array.isArray(pr.anexos) && pr.anexos.length > 0
          ? pr.anexos
          : (pr.imagem_base64 ? [{ id: 'anx_1', categoria: pr.tipo_receita || 'encaminhamento', imagem_base64: pr.imagem_base64, ocr: null }] : []);
        _copilotoState.anexos = anexos;
        _copilotoState.anexoIdx = 0;

        const ext = pr.dados_extras || {};
        _copilotoState.dados = mesclarDadosSisreg(criarDadosVaziosSisreg(), {
          codigo_solicitacao: ext.codigo_solicitacao || '',
          paciente_nome: pr.paciente_nome_ocr || nomePaciente,
          paciente_cns: pr.paciente_cns || '',
          paciente_dn: ext.paciente_data_nascimento || '',
          paciente_sexo: ext.paciente_sexo || '',
          paciente_mae: ext.paciente_mae || '',
          paciente_telefone: ext.paciente_telefone || '',
          paciente_endereco: ext.paciente_endereco || '',
          paciente_bairro: ext.paciente_bairro || '',
          paciente_cep: ext.paciente_cep || '',
          paciente_municipio: ext.paciente_municipio || 'Recife',
          paciente_uf: ext.paciente_uf || 'PE',
          tipo_vaga: ext.tipo_vaga || '',
          risco: ext.risco || '',
          especialidade_ou_exame: ext.especialidade || '',
          procedimentos_pedidos: ext.especialidade ? [ext.especialidade] : [],
          hipotese_diagnostica: ext.hipotese_diagnostica || '',
          cid10: ext.cid10 || '',
          medico_solicitante: pr.medico_emitente || '',
          observacoes_original: ext.justificativa || pr.observacoes || '',
          observacoes_revisada: ext.observacoes_revisada || ext.justificativa || pr.observacoes || '',
          alertas_digitacao: Array.isArray(ext.alertas_digitacao) ? ext.alertas_digitacao : []
        }, false);

        renderEstadoFormularioCopiloto();
        rebuscarProcedimentosCopiloto();

        if (anexos[0]?.imagem_base64 && (!ext.observacoes_revisada && (!ext.justificativa || !ext.paciente_municipio))) {
          const statusEl = document.getElementById('sisreg-ocr-status');
          if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.className = 'pr-status-box loading';
            statusEl.textContent = '⏳ Extraindo detalhes completos para o SISREG...';
          }
          await executarAnaliseIaCopiloto(anexos[0].imagem_base64, statusEl, true);
        }
        return;
      }
    } catch (_) {}

    renderEstadoFormularioCopiloto();
    if (abrirUpload) {
      document.getElementById('sisreg-file-upload')?.click();
    }
  }

  async function salvarFotoCopilotoNoPaciente() {
    if (!_copilotoState.patientId || _copilotoState.anexos.length === 0) {
      if (typeof showToast === 'function') showToast('Vincule um paciente da fila e adicione ao menos 1 arquivo.', true);
      return;
    }
    const d = _copilotoState.dados;
    const payload = {
      tipo_receita: 'sisreg',
      paciente_nome_ocr: d.paciente_nome || _copilotoState.patientNomeFila || null,
      paciente_cns: d.paciente_cns || null,
      medicamentos: d.especialidade_ou_exame || null,
      data_emissao: d.data_solicitacao || null,
      medico_emitente: [d.medico_solicitante, d.crm_conselho].filter(Boolean).join(' · ') || null,
      observacoes: d.observacoes_revisada || d.observacoes_original || null,
      fila_sugerida: 'Regulação',
      imagem_base64: _copilotoState.anexos[0].imagem_base64,
      anexos: _copilotoState.anexos,
      dados_extras: {
        destino_ia: 'sisreg',
        codigo_solicitacao: d.codigo_solicitacao || null,
        especialidade: d.especialidade_ou_exame || null,
        hipotese_diagnostica: d.hipotese_diagnostica || null,
        cid10: d.cid10 || null,
        justificativa: d.observacoes_original || d.observacoes_revisada || null,
        observacoes_revisada: d.observacoes_revisada || null,
        alertas_digitacao: Array.isArray(d.alertas_digitacao) ? d.alertas_digitacao : [],
        paciente_endereco: d.paciente_endereco || null,
        paciente_data_nascimento: d.paciente_dn || null,
        paciente_sexo: d.paciente_sexo || null,
        paciente_telefone: d.paciente_telefone || null,
        paciente_mae: d.paciente_mae || null,
        paciente_municipio: d.paciente_municipio || null,
        paciente_uf: d.paciente_uf || null,
        paciente_cep: d.paciente_cep || null,
        paciente_bairro: d.paciente_bairro || null,
        tipo_vaga: d.tipo_vaga || null,
        risco: d.risco || null
      }
    };
    try {
      const res = await fetch(`${getApiUrlBase()}/patients/${_copilotoState.patientId}/previa-receita`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error();
      if (typeof showToast === 'function') showToast('✅ Prévia salva neste paciente da Regulação!');
      if (typeof loadQueues === 'function') await loadQueues();
    } catch (_) {
      if (typeof showToast === 'function') showToast('Erro ao salvar prévia no paciente.', true);
    }
  }

  // ===== CONTROLE DIRECIONADO DE DEVOLUÇÕES (COM SOLUÇÃO, CHAT E PDF) =====
  function normTxtDev(str) {
    return normSisregFront(str);
  }

  function inferirSetorPorMotivoEProfFront(motivo, profissional = '') {
    const m = normTxtDev(motivo);
    const p = normTxtDev(profissional);
    if (/enderec|cadastr|municip|fora de recife|telefone|cns|residenc|comprovante/.test(m)) {
      return 'ACS';
    }
    if (/odont|dentist|juliana cavalcante|\bcro\b/.test(p)) return 'Odontologia';
    if (/enferm|mariana vaz|jorge marcio|lucelia|\bcoren\b/.test(p)) return 'Enfermagem';
    if (/\bacs\b|agente comunit|ana paula|ana lucia|lenilda|conceicao|joselita|alda|simone|patricia|telma|jeane|joselia|arlinda|nena|rosilene|fatima/.test(p)) {
      return 'ACS';
    }
    return 'Médico';
  }

  function popularSelectProfissionaisDevolucao(setor = 'Médico', selecionado = '') {
    const sel = document.getElementById('dev-profissional');
    if (!sel) return;
    const setorNorm = SETOR_DEV_META[setor] ? setor : 'Médico';
    const baseLista = PROFISSIONAIS_DEVOLUCAO_POR_SETOR[setorNorm] || [];
    const selNorm = normTxtDev(selecionado);
    let matched = '';
    if (selNorm) {
      matched = baseLista.find(p => normTxtDev(p) === selNorm)
        || baseLista.find(p => normTxtDev(p).includes(selNorm) || selNorm.includes(normTxtDev(p)))
        || '';
    }
    const opts = [`<option value="">Todos (${escSisreg(setorNorm)})</option>`]
      .concat(baseLista.map(p => `<option value="${escSisreg(p)}">${escSisreg(p)}</option>`));
    if (selecionado && !matched) {
      opts.push(`<option value="${escSisreg(selecionado)}">${escSisreg(selecionado)}</option>`);
      matched = selecionado;
    }
    sel.innerHTML = opts.join('');
    sel.value = matched || '';
  }

  function onDevMotivoChange() {
    const motEl = document.getElementById('dev-motivo');
    const setorEl = document.getElementById('dev-setor-destino');
    if (!motEl || !setorEl) return;
    const motNorm = normTxtDev(motEl.value);
    if (/enderec|cadastr|municip|fora de recife|telefone|cns/.test(motNorm)) {
      setorEl.value = 'ACS';
      popularSelectProfissionaisDevolucao('ACS');
    } else if (setorEl.value === 'ACS') {
      setorEl.value = 'Médico';
      popularSelectProfissionaisDevolucao('Médico');
    }
  }

  function onDevSetorDestinoChange() {
    const setorEl = document.getElementById('dev-setor-destino');
    const setor = setorEl ? setorEl.value : 'Médico';
    popularSelectProfissionaisDevolucao(setor);
  }

  function preencherDevolucaoDaFichaAtual() {
    const d = _copilotoState.dados;
    trocarAbaCopilotoRegulacao('devolucoes');
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    set('dev-pac-nome', d.paciente_nome || _copilotoState.patientNomeFila || '');
    set('dev-protocolo', d.codigo_solicitacao || '');
    set('dev-procedimento', d.especialidade_ou_exame || '');
    set('dev-telefone', d.paciente_telefone || '');
    const endInfo = verificarEnderecoRecifeFront({
      municipio: d.paciente_municipio,
      uf: d.paciente_uf,
      cep: d.paciente_cep,
      endereco: d.paciente_endereco
    });
    const motEl = document.getElementById('dev-motivo');
    const ehProblemaCadastro = endInfo.status === 'fora_recife' || !d.paciente_telefone;
    if (motEl) {
      motEl.value = endInfo.status === 'fora_recife'
        ? 'Endereço de outra cidade (fora de Recife) / Cadastro'
        : (!d.paciente_telefone
          ? 'Telefone / CNS / dados cadastrais desatualizados'
          : 'Erro de digitação / texto clínico / CID');
    }
    const setorAuto = ehProblemaCadastro
      ? 'ACS'
      : inferirSetorPorMotivoEProfFront(motEl ? motEl.value : '', d.medico_solicitante || '');
    const setorEl = document.getElementById('dev-setor-destino');
    if (setorEl) setorEl.value = setorAuto;
    popularSelectProfissionaisDevolucao(setorAuto, d.medico_solicitante || '');
    set('dev-obs', endInfo.status === 'fora_recife' ? (endInfo.alerta || '') : (d.alertas_digitacao?.join('; ') || ''));
    document.getElementById('dev-pac-nome')?.focus();
  }

  function aplicarFiltrosDevolucoesLista(todas, statusFlt, setorFlt, busca) {
    const bNorm = normTxtDev(busca || '');
    return (Array.isArray(todas) ? todas : []).filter(item => {
      const st = item.status || 'pendente';
      if (statusFlt === 'abertas') {
        if (st !== 'pendente' && st !== 'respondida') return false;
      } else if (statusFlt && statusFlt !== 'todas') {
        if (st !== statusFlt) return false;
      }
      const setorItem = item.setor_destino || inferirSetorPorMotivoEProfFront(item.motivo, item.profissional_equipe);
      if (setorFlt && setorFlt !== 'todos' && setorItem !== setorFlt) return false;
      if (bNorm) {
        const hay = normTxtDev(`${item.paciente_nome || ''} ${item.codigo_solicitacao || ''} ${item.procedimento || ''} ${item.motivo || ''} ${item.profissional_equipe || ''} ${item.observacao || ''} ${item.solucao || ''} ${setorItem}`);
        if (!hay.includes(bNorm)) return false;
      }
      return true;
    });
  }

  function onDevFiltroListaChange() {
    _sisregDevSetorFiltro = document.getElementById('dev-flt-setor')?.value || 'todos';
    _sisregDevBusca = document.getElementById('dev-flt-busca')?.value || '';
    _sisregDevolucoes = aplicarFiltrosDevolucoesLista(_sisregDevolucoesTodas, _sisregDevFiltro, _sisregDevSetorFiltro, _sisregDevBusca);
    renderDevolucoesSisreg();
  }

  function filtrarDevolucoesSisreg(flt) {
    _sisregDevFiltro = flt || 'abertas';
    const btns = {
      abertas: 'dev-flt-abertas',
      pendente: 'dev-flt-pend',
      respondida: 'dev-flt-resp',
      corrigida: 'dev-flt-corr',
      todas: 'dev-flt-todas'
    };
    Object.keys(btns).forEach(k => {
      document.getElementById(btns[k])?.classList.toggle('active', k === _sisregDevFiltro);
    });
    _sisregDevolucoes = aplicarFiltrosDevolucoesLista(_sisregDevolucoesTodas, _sisregDevFiltro, _sisregDevSetorFiltro, _sisregDevBusca);
    renderDevolucoesSisreg();
  }

  function atualizarBadgesDevolucoesSetores() {
    const todas = _sisregDevolucoesTodas || [];
    const abertasRegulacao = todas.filter(x => x.status === 'pendente' || x.status === 'respondida').length;
    const badge = document.getElementById('sisreg-dev-badge');
    const badgeBar = document.getElementById('sisreg-dev-badge-bar');
    [badge, badgeBar].forEach(el => {
      if (el) {
        el.style.display = abertasRegulacao > 0 ? 'inline-flex' : 'none';
        el.textContent = String(abertasRegulacao);
      }
    });
    document.querySelectorAll('.sisreg-dev-badge-setor').forEach(el => {
      const setor = el.dataset.setor || '';
      const count = todas.filter(x => {
        if ((x.status || 'pendente') !== 'pendente') return false;
        const s = x.setor_destino || inferirSetorPorMotivoEProfFront(x.motivo, x.profissional_equipe);
        return !setor || s === setor;
      }).length;
      el.style.display = count > 0 ? 'inline-flex' : 'none';
      el.textContent = String(count);
    });
  }

  async function carregarDevolucoesSisreg() {
    try {
      const res = await fetch(`${getApiUrlBase()}/sisreg/devolucoes?status=todas`, { cache: 'no-store' });
      if (!res.ok) return;
      _sisregDevolucoesTodas = await res.json();
      atualizarBadgesDevolucoesSetores();
      _sisregDevolucoes = aplicarFiltrosDevolucoesLista(_sisregDevolucoesTodas, _sisregDevFiltro, _sisregDevSetorFiltro, _sisregDevBusca);
      renderDevolucoesSisreg();
      const modalProf = document.getElementById('modal-devolucoes-profissional');
      if (modalProf && modalProf.classList.contains('show')) {
        renderModalDevolucoesProfissional();
      }
    } catch (_) {}
  }

  function formatarDataRecifeDev(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Recife',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(d);
  }

  function badgeStatusDevolucaoHtml(status) {
    if (status === 'corrigida') {
      return '<span class="sisreg-pill-mini ok">✅ Corrigida</span>';
    }
    if (status === 'respondida') {
      return '<span class="sisreg-pill-mini" style="background:#dbeafe;color:#1e40af;border:1px solid #93c5fd;">💬 Solução Recebida</span>';
    }
    return '<span class="sisreg-pill-mini err">⏳ Pendente</span>';
  }

  function badgeSetorDevolucaoHtml(setor) {
    const meta = SETOR_DEV_META[setor] || SETOR_DEV_META['Médico'];
    return `<span class="sisreg-pill-mini" style="background:${meta.bg};color:${meta.fg};border:1px solid ${meta.fg}33;">${meta.icon} ${escSisreg(setor)}</span>`;
  }

  function renderDevolucoesSisreg() {
    const listEl = document.getElementById('sisreg-dev-lista');
    atualizarBadgesDevolucoesSetores();
    if (!listEl) return;
    if (!_sisregDevolucoes || _sisregDevolucoes.length === 0) {
      listEl.innerHTML = `<div class="sisreg-muted" style="text-align:center;padding:18px;">Nenhuma devolução encontrada nos filtros atuais.</div>`;
      return;
    }

    listEl.innerHTML = _sisregDevolucoes.map(item => {
      const st = item.status || 'pendente';
      const setorDestino = item.setor_destino || inferirSetorPorMotivoEProfFront(item.motivo, item.profissional_equipe);
      const dataFmt = formatarDataRecifeDev(item.created_at);
      const solFmt = formatarDataRecifeDev(item.solucao_em);
      const hasSolucao = Boolean(item.solucao && String(item.solucao).trim());

      return `
        <div class="sisreg-dev-card ${st === 'corrigida' ? 'ok' : (st === 'respondida' ? 'resp' : 'pend')}" style="${st === 'respondida' ? 'border-left-color:#2563eb;background:#f8fbff;' : ''}">
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <strong style="font-size:13.5px;color:#0f172a;">${escSisreg(item.paciente_nome)}</strong>
              ${item.codigo_solicitacao ? `<code class="sisreg-code-badge">${escSisreg(item.codigo_solicitacao)}</code>` : ''}
              ${badgeSetorDevolucaoHtml(setorDestino)}
              ${badgeStatusDevolucaoHtml(st)}
              ${dataFmt ? `<span style="font-size:11px;color:#64748b;font-weight:700;">🕒 ${escSisreg(dataFmt)}</span>` : ''}
            </div>
            <div style="display:flex;gap:5px;flex-wrap:wrap;">
              ${st !== 'corrigida'
                ? `<button type="button" class="btn btn-primary btn-sm" style="background:#16a34a;border-color:#15803d;" onclick="alternarStatusDevolucaoSisreg(${item.id},'corrigida')">✅ Corrigida</button>`
                : `<button type="button" class="btn btn-outline btn-sm" onclick="alternarStatusDevolucaoSisreg(${item.id},'pendente')">↩️ Reabrir</button>`}
              <button type="button" class="btn btn-outline btn-sm" onclick="abrirSolucaoInlineRegulacao(${item.id})" title="Registrar/editar solução ou comentário">✏️ Solução</button>
              <button type="button" class="btn btn-outline btn-sm" onclick="avisarProfissionalDevolucaoChat(${item.id})" title="Enviar alerta no canal ${escSisreg(setorDestino)} do chat interno">💬 Avisar ${escSisreg(setorDestino)}</button>
              <button type="button" class="btn btn-sm" style="background:#fee2e2;color:#991b1b;border:none;" onclick="excluirDevolucaoSisreg(${item.id})" title="Excluir registro">🗑️</button>
            </div>
          </div>
          <div style="font-size:12px;color:#334155;margin-top:5px;">
            <b>Motivo:</b> ${escSisreg(item.motivo)}
            ${item.procedimento ? ` · <b>Proc.:</b> ${escSisreg(item.procedimento)}` : ''}
            ${item.telefone ? ` · <b>Tel.:</b> ${escSisreg(item.telefone)}` : ''}
            ${item.profissional_equipe ? ` · <b>Responsável:</b> ${escSisreg(item.profissional_equipe)}` : ''}
          </div>
          ${item.observacao ? `<div style="font-size:11.5px;color:#475569;margin-top:5px;background:#f8fafc;padding:6px 8px;border-radius:6px;border:1px solid #e2e8f0;"><b>Pendência / Orientação:</b> ${escSisreg(item.observacao)}</div>` : ''}
          ${hasSolucao ? `
            <div style="font-size:12px;color:#065f46;margin-top:5px;background:#ecfdf5;padding:7px 9px;border-radius:6px;border:1px solid #6ee7b7;display:flex;justify-content:space-between;gap:8px;align-items:flex-start;flex-wrap:wrap;">
              <div>
                <strong>✅ Solução / Comentário${item.solucao_autor ? ` (${escSisreg(item.solucao_autor)})` : ''}${solFmt ? ` · ${escSisreg(solFmt)}` : ''}:</strong>
                <span>${escSisreg(item.solucao)}</span>
              </div>
              <button type="button" class="btn btn-outline btn-sm" style="padding:2px 8px;font-size:11px;" onclick="copiarTextoSisreg(decodeURIComponent('${encodeURIComponent(item.solucao)}'), 'Solução copiada')">📋 Copiar Solução</button>
            </div>
          ` : ''}
          <div id="dev-inline-sol-box-${item.id}" style="display:none;margin-top:7px;padding:8px;background:#f1f5f9;border-radius:8px;border:1px solid #cbd5e1;">
            <textarea id="dev-inline-sol-txt-${item.id}" rows="2" style="width:100%;padding:6px 8px;border:1.5px solid #93c5fd;border-radius:6px;font-size:12px;font-weight:700;" placeholder="Digite a solução / comentário (ex: mudou para Rua..., procedimento correto é...)...">${escSisreg(item.solucao || '')}</textarea>
            <div style="display:flex;gap:6px;margin-top:5px;justify-content:flex-end;">
              <button type="button" class="btn btn-outline btn-sm" onclick="abrirSolucaoInlineRegulacao(${item.id})">Cancelar</button>
              <button type="button" class="btn btn-primary btn-sm" onclick="salvarSolucaoInlineRegulacao(${item.id})">💾 Salvar Solução</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function abrirSolucaoInlineRegulacao(id) {
    const box = document.getElementById(`dev-inline-sol-box-${id}`);
    if (!box) return;
    const aberto = box.style.display !== 'none';
    box.style.display = aberto ? 'none' : 'block';
    if (!aberto) {
      document.getElementById(`dev-inline-sol-txt-${id}`)?.focus();
    }
  }

  async function salvarSolucaoInlineRegulacao(id) {
    const txt = document.getElementById(`dev-inline-sol-txt-${id}`)?.value.trim() || '';
    if (!txt) {
      if (typeof showToast === 'function') showToast('Digite a solução ou comentário antes de salvar.', true);
      return;
    }
    const devNome = localStorage.getItem('usf_device_nome');
    const autor = (devNome && devNome !== 'Sem nome') ? devNome : '📋 Regulação';
    try {
      const res = await fetch(`${getApiUrlBase()}/sisreg/devolucoes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ solucao: txt, solucao_autor: autor, notificar_chat: false })
      });
      if (!res.ok) throw new Error();
      if (typeof showToast === 'function') showToast('✅ Solução salva!');
      await carregarDevolucoesSisreg();
    } catch (_) {
      if (typeof showToast === 'function') showToast('Erro ao salvar solução.', true);
    }
  }

  async function salvarNovaDevolucaoSisreg() {
    const nome = document.getElementById('dev-pac-nome')?.value.trim() || '';
    const motivo = document.getElementById('dev-motivo')?.value.trim() || '';
    const setorDestino = document.getElementById('dev-setor-destino')?.value || 'Médico';
    const enviarChat = document.getElementById('dev-enviar-chat')?.checked !== false;
    if (!nome) {
      if (typeof showToast === 'function') showToast('Informe o nome do paciente devolvido.', true);
      return;
    }
    const body = {
      paciente_nome: nome,
      codigo_solicitacao: document.getElementById('dev-protocolo')?.value.trim() || null,
      procedimento: document.getElementById('dev-procedimento')?.value.trim() || null,
      motivo,
      setor_destino: setorDestino,
      telefone: document.getElementById('dev-telefone')?.value.trim() || null,
      profissional_equipe: document.getElementById('dev-profissional')?.value.trim() || null,
      observacao: document.getElementById('dev-obs')?.value.trim() || null,
      enviar_chat: enviarChat
    };
    try {
      const res = await fetch(`${getApiUrlBase()}/sisreg/devolucoes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error();
      const created = await res.json();
      ['dev-pac-nome', 'dev-protocolo', 'dev-procedimento', 'dev-telefone', 'dev-obs'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      const profSel = document.getElementById('dev-profissional');
      if (profSel) profSel.value = '';
      if (typeof showToast === 'function') {
        showToast(created.chat_notificado
          ? `✅ Devolução registrada e alerta enviado no canal ${setorDestino}!`
          : `✅ Devolução registrada e direcionada para ${setorDestino}!`);
      }
      await carregarDevolucoesSisreg();
    } catch (_) {
      if (typeof showToast === 'function') showToast('Erro ao registrar devolução.', true);
    }
  }

  async function alternarStatusDevolucaoSisreg(id, status) {
    try {
      const res = await fetch(`${getApiUrlBase()}/sisreg/devolucoes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (!res.ok) throw new Error();
      await carregarDevolucoesSisreg();
      if (typeof showToast === 'function') showToast(status === 'corrigida' ? '✅ Devolução marcada como corrigida!' : '↩️ Reaberta.');
    } catch (_) {
      if (typeof showToast === 'function') showToast('Erro ao atualizar devolução.', true);
    }
  }

  async function excluirDevolucaoSisreg(id) {
    if (!confirm('Remover este registro de devolução?')) return;
    try {
      await fetch(`${getApiUrlBase()}/sisreg/devolucoes/${id}`, { method: 'DELETE' });
      await carregarDevolucoesSisreg();
    } catch (_) {}
  }

  async function avisarProfissionalDevolucaoChat(idOuIdx) {
    const item = (_sisregDevolucoesTodas || []).find(x => x.id === idOuIdx)
      || (_sisregDevolucoes || [])[idOuIdx];
    if (!item) return;
    const setorDestino = item.setor_destino || inferirSetorPorMotivoEProfFront(item.motivo, item.profissional_equipe);
    const canal = (SETOR_DEV_META[setorDestino]?.canal) || 'medico';
    const texto = `↩️ DEVOLUÇÃO SISREG [Setor: ${setorDestino}${item.profissional_equipe ? ' · ' + item.profissional_equipe : ''}] — Paciente: ${item.paciente_nome}` +
      (item.codigo_solicitacao ? ` (Prot: ${item.codigo_solicitacao})` : '') +
      (item.procedimento ? ` | Proc: ${item.procedimento}` : '') +
      ` | Motivo: ${item.motivo}` +
      (item.observacao ? ` | Detalhe: ${item.observacao}` : '') +
      `\n👉 Responda pelo atalho "↩️ Devoluções SISREG" informando a correção/solução.`;
    try {
      const res = await fetch(`${getApiUrlBase()}/chat/canais/${canal}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autor: '📋 Regulação', texto, urgente: true })
      });
      if (!res.ok) throw new Error();
      if (typeof showToast === 'function') showToast(`💬 Aviso enviado ao canal ${setorDestino} no chat interno!`);
    } catch (_) {
      if (typeof showToast === 'function') showToast('Não foi possível enviar mensagem no chat.', true);
    }
  }

  function avisarMedicoDevolucaoChat(idx) {
    return avisarProfissionalDevolucaoChat(idx);
  }

  function exportarDevolucoesSisregPDF(listaCustom = null, tituloExtra = '') {
    const lista = Array.isArray(listaCustom) ? listaCustom : (_sisregDevolucoes || []);
    if (!lista.length) {
      if (typeof showToast === 'function') showToast('Nenhuma devolução na lista atual para gerar PDF.', true);
      return;
    }
    if (!window.jspdf || !window.jspdf.jsPDF) {
      if (typeof showToast === 'function') showToast('Biblioteca PDF ainda carregando...', true);
      return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('l');
    const dataHoje = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Recife' }).format(new Date());

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('Lista de Devoluções SISREG III — USF Chico Mendes (DS5)', 148, 13, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(
      `Emitido em: ${dataHoje} | Total listado: ${lista.length}${tituloExtra ? ` | ${tituloExtra}` : ''}`,
      148,
      20,
      { align: 'center' }
    );

    const statusLabel = s => s === 'corrigida' ? 'Corrigida' : (s === 'respondida' ? 'Respondida' : 'Pendente');
    const bodyRows = lista.map((item, idx) => {
      const setor = item.setor_destino || inferirSetorPorMotivoEProfFront(item.motivo, item.profissional_equipe);
      const direcionado = item.profissional_equipe ? `${setor} (${item.profissional_equipe})` : setor;
      const solTxt = item.solucao
        ? `${item.solucao}${item.solucao_autor ? ` [${item.solucao_autor}]` : ''}`
        : '—';
      return [
        idx + 1,
        formatarDataRecifeDev(item.created_at) || dataHoje,
        item.paciente_nome || '—',
        item.codigo_solicitacao || '—',
        item.procedimento || '—',
        item.motivo || '—',
        direcionado,
        item.observacao || '—',
        solTxt,
        statusLabel(item.status)
      ];
    });

    doc.autoTable({
      startY: 25,
      head: [['Nº', 'Data/Hora', 'Paciente', 'Protocolo', 'Procedimento', 'Motivo', 'Direcionado', 'Pendência', 'Solução / Comentário', 'Status']],
      body: bodyRows,
      theme: 'grid',
      headStyles: { fillColor: [15, 44, 115], fontSize: 7.5 },
      bodyStyles: { fontSize: 7.2, cellPadding: 2 },
      alternateRowStyles: { fillColor: [241, 245, 249] },
      columnStyles: {
        0: { cellWidth: 9 },
        1: { cellWidth: 21 },
        2: { cellWidth: 32 },
        3: { cellWidth: 20 },
        7: { cellWidth: 42 },
        8: { cellWidth: 48 },
        9: { cellWidth: 20 }
      }
    });

    const resumoPorSetor = {};
    lista.forEach(item => {
      const s = item.setor_destino || inferirSetorPorMotivoEProfFront(item.motivo, item.profissional_equipe);
      if (!resumoPorSetor[s]) resumoPorSetor[s] = { pendente: 0, respondida: 0, corrigida: 0, total: 0 };
      resumoPorSetor[s].total++;
      if (item.status === 'corrigida') resumoPorSetor[s].corrigida++;
      else if (item.status === 'respondida') resumoPorSetor[s].respondida++;
      else resumoPorSetor[s].pendente++;
    });
    const keys = Object.keys(resumoPorSetor).sort();
    if (keys.length > 0) {
      const yNext = (doc.lastAutoTable ? doc.lastAutoTable.finalY : 30) + 8;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('Resumo por Setor Responsável', 14, yNext);
      doc.autoTable({
        startY: yNext + 3,
        head: [['Setor', 'Pendentes', 'Solução Recebida', 'Corrigidas', 'Total']],
        body: keys.map(s => [s, resumoPorSetor[s].pendente, resumoPorSetor[s].respondida, resumoPorSetor[s].corrigida, resumoPorSetor[s].total]),
        theme: 'grid',
        headStyles: { fillColor: [15, 118, 110], fontSize: 8.5 },
        bodyStyles: { fontSize: 8 }
      });
    }

    doc.save(`devolucoes_sisreg_${dataHoje.replace(/\//g, '-')}.pdf`);
    if (typeof showToast === 'function') showToast('✅ Lista de devoluções exportada em PDF!');
  }

  // ===== MODAL RÁPIDO PARA PROFISSIONAIS / ACS COMENTAREM SOLUÇÕES =====
  function detectarNomeProfissionalAtualFront(setor = 'Médico') {
    const keyMap = { 'Médico': 'medico', 'Enfermagem': 'enfermagem', 'Odontologia': 'odontologia' };
    const k = keyMap[setor];
    if (k) {
      const v = document.getElementById(`profissional-${k}`)?.value;
      if (v) return v;
    }
    const devNome = localStorage.getItem('usf_device_nome');
    if (devNome && devNome !== 'Sem nome') return devNome;
    return '';
  }

  function abrirModalDevolucoesProfissional(setor = 'Médico') {
    _devProfModalState.setor = SETOR_DEV_META[setor] ? setor : 'todos';
    if (!_devProfModalState.status) _devProfModalState.status = 'abertas';
    const modal = document.getElementById('modal-devolucoes-profissional');
    if (!modal) return;
    renderModalDevolucoesProfissional();
    modal.classList.add('show');
    carregarDevolucoesSisreg();
  }

  function fecharModalDevolucoesProfissional() {
    document.getElementById('modal-devolucoes-profissional')?.classList.remove('show');
  }

  function trocarSetorModalDevProf(setor) {
    _devProfModalState.setor = setor || 'todos';
    renderModalDevolucoesProfissional();
  }

  function trocarFiltroModalDevProf(flt) {
    _devProfModalState.status = flt || 'abertas';
    renderModalDevolucoesProfissional();
  }

  function onBuscaModalDevProfInput(val) {
    _devProfModalState.busca = val || '';
    renderListaDevolucoesProfissional();
  }

  function aplicarAtalhoSolucaoDevProf(id, textoModelo) {
    const ta = document.getElementById(`dev-prof-sol-${id}`);
    if (!ta) return;
    ta.value = textoModelo;
    ta.focus();
    const len = ta.value.length;
    ta.setSelectionRange(len, len);
  }

  function obterListaFiltradaModalProf() {
    return aplicarFiltrosDevolucoesLista(
      _sisregDevolucoesTodas,
      _devProfModalState.status,
      _devProfModalState.setor,
      _devProfModalState.busca
    );
  }

  function exportarDevolucoesProfissionalPDF() {
    const lista = obterListaFiltradaModalProf();
    const labelSetor = _devProfModalState.setor === 'todos' ? 'Todos os Setores' : `Setor: ${_devProfModalState.setor}`;
    exportarDevolucoesSisregPDF(lista, labelSetor);
  }

  function renderModalDevolucoesProfissional() {
    const modal = document.getElementById('modal-devolucoes-profissional');
    if (!modal) return;
    const autorPadrao = detectarNomeProfissionalAtualFront(_devProfModalState.setor);
    const todas = _sisregDevolucoesTodas || [];
    const contarPendSetor = s => todas.filter(x => {
      if ((x.status || 'pendente') !== 'pendente') return false;
      const st = x.setor_destino || inferirSetorPorMotivoEProfFront(x.motivo, x.profissional_equipe);
      return s === 'todos' || st === s;
    }).length;

    const setoresBotoes = [
      { id: 'Médico', label: '🩺 Médico' },
      { id: 'Enfermagem', label: '👩‍⚕️ Enfermagem' },
      { id: 'Odontologia', label: '🦷 Odontologia' },
      { id: 'ACS', label: '🧡 ACS' },
      { id: 'todos', label: '📋 Todos' }
    ].map(s => {
      const cnt = contarPendSetor(s.id);
      const act = _devProfModalState.setor === s.id ? 'active' : '';
      return `<button type="button" class="btn-filter ${act}" onclick="trocarSetorModalDevProf('${s.id}')">${s.label}${cnt > 0 ? ` (${cnt})` : ''}</button>`;
    }).join('');

    const profDatalist = (PROFISSIONAIS_DEVOLUCAO_POR_SETOR[_devProfModalState.setor]
      || Object.values(PROFISSIONAIS_DEVOLUCAO_POR_SETOR).flat())
      .map(p => `<option value="${escSisreg(p)}"></option>`).join('');

    modal.innerHTML = `
      <div class="previa-modal-card wide" style="max-width:1020px;">
        <div class="previa-modal-head" style="background:linear-gradient(135deg,#9a3412,#c2410c);">
          <div>
            <div style="font-weight:900;font-size:15.5px;">↩️ Devoluções SISREG — Comentários e Soluções</div>
            <div style="font-size:11.5px;opacity:0.9;">Informe a correção (endereço/cadastro c/ ACS ou procedimento/justificativa c/ Médico, Enfermagem ou Dentista) para a Regulação corrigir</div>
          </div>
          <button type="button" class="previa-btn-close-red" onclick="fecharModalDevolucoesProfissional()">✕ Fechar</button>
        </div>
        <div class="previa-modal-body" style="background:#f8fafc;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
            <div style="display:flex;gap:6px;flex-wrap:wrap;">${setoresBotoes}</div>
            <button type="button" class="btn btn-sm" style="background:#dc2626;color:#fff;border:none;font-weight:800;" onclick="exportarDevolucoesProfissionalPDF()">📄 Imprimir Lista (PDF)</button>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;background:#fff;padding:10px;border-radius:10px;border:1.5px solid #cbd5e1;margin-bottom:10px;">
            <div style="display:flex;gap:5px;flex-wrap:wrap;">
              <button type="button" class="btn-filter ${_devProfModalState.status === 'abertas' ? 'active' : ''}" onclick="trocarFiltroModalDevProf('abertas')">📋 Abertas</button>
              <button type="button" class="btn-filter ${_devProfModalState.status === 'pendente' ? 'active' : ''}" onclick="trocarFiltroModalDevProf('pendente')">⏳ Pendentes</button>
              <button type="button" class="btn-filter ${_devProfModalState.status === 'respondida' ? 'active' : ''}" onclick="trocarFiltroModalDevProf('respondida')">💬 Respondidas</button>
              <button type="button" class="btn-filter ${_devProfModalState.status === 'corrigida' ? 'active' : ''}" onclick="trocarFiltroModalDevProf('corrigida')">✅ Corrigidas</button>
              <button type="button" class="btn-filter ${_devProfModalState.status === 'todas' ? 'active' : ''}" onclick="trocarFiltroModalDevProf('todas')">🗂️ Todas</button>
            </div>
            <input type="text" id="dev-prof-busca-inp" value="${escSisreg(_devProfModalState.busca)}" oninput="onBuscaModalDevProfInput(this.value)" placeholder="🔎 Buscar paciente ou procedimento..." style="flex:1;min-width:170px;padding:6px 10px;border:1.5px solid #cbd5e1;border-radius:8px;font-size:12.5px;font-weight:700;">
            <input type="text" id="dev-prof-autor-nome" list="dev-prof-autor-list" value="${escSisreg(autorPadrao)}" placeholder="Seu nome (Profissional / ACS) *" style="min-width:190px;padding:6px 10px;border:1.5px solid #93c5fd;border-radius:8px;font-size:12.5px;font-weight:700;">
            <datalist id="dev-prof-autor-list">${profDatalist}</datalist>
          </div>
          <div id="dev-prof-modal-lista" class="sisreg-dev-lista" style="max-height:56vh;"></div>
        </div>
      </div>
    `;
    renderListaDevolucoesProfissional();
  }

  function renderListaDevolucoesProfissional() {
    const el = document.getElementById('dev-prof-modal-lista');
    if (!el) return;
    const lista = obterListaFiltradaModalProf();
    if (!lista.length) {
      el.innerHTML = '<div class="sisreg-muted" style="text-align:center;padding:24px;">Nenhuma devolução encontrada para este setor/filtro.</div>';
      return;
    }

    el.innerHTML = lista.map(item => {
      const setorItem = item.setor_destino || inferirSetorPorMotivoEProfFront(item.motivo, item.profissional_equipe);
      const isAcs = setorItem === 'ACS';
      const placeholder = isAcs
        ? 'Ex: Verifiquei o cadastro — paciente mudou para a Rua..., nº..., Bairro... / Novo tel: (81)...'
        : 'Ex: O procedimento correto é..., justificativa clínica..., CID...';
      const atalhosHtml = isAcs
        ? `
          <button type="button" class="motivo-chip" onclick="aplicarAtalhoSolucaoDevProf(${item.id}, 'Paciente mudou para o endereço: Rua , nº , Bairro , CEP .')">🏠 Mudou de endereço</button>
          <button type="button" class="motivo-chip" onclick="aplicarAtalhoSolucaoDevProf(${item.id}, 'Telefone atualizado do paciente: (81) 9')">📞 Novo telefone</button>
          <button type="button" class="motivo-chip" onclick="aplicarAtalhoSolucaoDevProf(${item.id}, 'Cadastro e residência confirmados em Recife na microárea.')">📍 Cadastro confirmado</button>
        `
        : `
          <button type="button" class="motivo-chip" onclick="aplicarAtalhoSolucaoDevProf(${item.id}, 'O procedimento correto no SISREG é: ')">🩺 Procedimento correto</button>
          <button type="button" class="motivo-chip" onclick="aplicarAtalhoSolucaoDevProf(${item.id}, 'Justificativa clínica complementar: ')">📝 Justificativa clínica</button>
          <button type="button" class="motivo-chip" onclick="aplicarAtalhoSolucaoDevProf(${item.id}, 'CID-10 correto:  | Solicitação readequada.')">🧬 Corrigir CID</button>
        `;
      const dataFmt = formatarDataRecifeDev(item.created_at);
      return `
        <div class="sisreg-dev-card ${item.status === 'corrigida' ? 'ok' : (item.status === 'respondida' ? 'resp' : 'pend')}">
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <strong style="font-size:14px;color:#0f172a;">${escSisreg(item.paciente_nome)}</strong>
              ${item.codigo_solicitacao ? `<code class="sisreg-code-badge">${escSisreg(item.codigo_solicitacao)}</code>` : ''}
              ${badgeSetorDevolucaoHtml(setorItem)}
              ${badgeStatusDevolucaoHtml(item.status || 'pendente')}
              ${dataFmt ? `<span style="font-size:11px;color:#64748b;font-weight:700;">🕒 ${escSisreg(dataFmt)}</span>` : ''}
            </div>
          </div>
          <div style="font-size:12px;color:#334155;margin-top:5px;">
            <b>Motivo:</b> ${escSisreg(item.motivo)}
            ${item.procedimento ? ` · <b>Proc.:</b> ${escSisreg(item.procedimento)}` : ''}
            ${item.telefone ? ` · <b>Tel.:</b> ${escSisreg(item.telefone)}` : ''}
            ${item.profissional_equipe ? ` · <b>Direcionado:</b> ${escSisreg(item.profissional_equipe)}` : ''}
          </div>
          ${item.observacao ? `<div style="font-size:12px;color:#7c2d12;margin-top:5px;background:#fff7ed;padding:6px 8px;border-radius:6px;border:1px solid #fed7aa;"><b>Solicitação da Regulação:</b> ${escSisreg(item.observacao)}</div>` : ''}
          <div style="margin-top:8px;">
            <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:5px;">
              <span style="font-size:11px;font-weight:800;color:#475569;">Atalhos de resposta:</span>
              ${atalhosHtml}
            </div>
            <textarea id="dev-prof-sol-${item.id}" rows="2" placeholder="${placeholder}" style="width:100%;padding:7px 9px;border:1.5px solid #93c5fd;border-radius:8px;font-size:12.5px;font-weight:700;color:#0f172a;">${escSisreg(item.solucao || '')}</textarea>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap;">
              <span style="font-size:11px;color:#64748b;font-weight:700;">Ao enviar, o comentário aparece na Regulação e gera alerta no canal 📋 Regulação do chat interno.</span>
              <button type="button" class="btn btn-primary btn-sm" style="background:#0f766e;border-color:#0f766e;font-weight:800;" onclick="salvarSolucaoModalProfissional(${item.id}, this)">💾 Enviar Solução para Regulação</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  async function salvarSolucaoModalProfissional(id, btn) {
    const sol = document.getElementById(`dev-prof-sol-${id}`)?.value.trim() || '';
    if (!sol) {
      if (typeof showToast === 'function') showToast('Digite a solução ou comentário antes de enviar.', true);
      return;
    }
    const autorInp = document.getElementById('dev-prof-autor-nome')?.value.trim() || '';
    const autor = autorInp || _devProfModalState.setor || 'Profissional';
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
    try {
      const res = await fetch(`${getApiUrlBase()}/sisreg/devolucoes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ solucao: sol, solucao_autor: autor, notificar_chat: true })
      });
      if (!res.ok) throw new Error();
      if (typeof showToast === 'function') showToast('✅ Solução enviada e Regulação avisada no chat interno!');
      await carregarDevolucoesSisreg();
    } catch (_) {
      if (typeof showToast === 'function') showToast('Erro ao enviar solução.', true);
    } finally {
      if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
  }

  // ===== MODAL GLOBAL PARA MÉDICOS / ENFERMAGEM / ODONTOLOGIA =====
  function abrirModalSisregConsulta(setor = 'Médico', aba = 'busca', termoInicial = '') {
    _modalMedState.setor = setor || 'Médico';
    _modalMedState.aba = aba === 'leitor' ? 'leitor' : 'busca';
    const modal = document.getElementById('modal-sisreg-medico');
    if (!modal) return;
    const tit = document.getElementById('sm-titulo');
    if (tit) tit.textContent = `🔎 SISREG III — Consulta e Leitor (${_modalMedState.setor} · DS5)`;
    trocarAbaModalSisregMedico(_modalMedState.aba);
    if (termoInicial) {
      const inp = document.getElementById('sm-busca-input');
      if (inp) inp.value = termoInicial;
    }
    inicializarPanZoomModalMedico();
    garantirCatalogoSisregCarregado().then(() => {
      executarBuscaModalSisregMedico();
      renderSugestoesModalMedico();
    });
    modal.classList.add('show');
    if (_modalMedState.aba === 'busca') {
      setTimeout(() => document.getElementById('sm-busca-input')?.focus(), 80);
    }
  }

  function abrirModalSisregLeitor(setor = 'Médico') {
    abrirModalSisregConsulta(setor, 'leitor');
  }

  function fecharModalSisregMedico() {
    document.getElementById('modal-sisreg-medico')?.classList.remove('show');
    revogarMedPdfBlobUrl();
  }

  function trocarAbaModalSisregMedico(aba) {
    _modalMedState.aba = aba;
    document.getElementById('sm-tab-busca')?.classList.toggle('active', aba === 'busca');
    document.getElementById('sm-tab-leitor')?.classList.toggle('active', aba === 'leitor');
    const pb = document.getElementById('sm-pane-busca');
    const pl = document.getElementById('sm-pane-leitor');
    if (pb) pb.style.display = aba === 'busca' ? 'block' : 'none';
    if (pl) pl.style.display = aba === 'leitor' ? 'block' : 'none';
    if (aba === 'busca') executarBuscaModalSisregMedico();
  }

  function executarBuscaModalSisregMedico() {
    const tbody = document.getElementById('sm-busca-tbody');
    if (!tbody) return;
    const q = document.getElementById('sm-busca-input')?.value || '';
    const tipo = document.getElementById('sm-busca-tipo')?.value || 'all';
    const idade = document.getElementById('sm-busca-idade')?.value || '';
    const tipoVaga = document.getElementById('sm-busca-vaga')?.value || '';
    const lista = buscarProcedimentosFront(q, { tipo, idade, tipoVaga, limite: 300 });
    atualizarRodapeCatalogoUI(lista.length);

    if (lista.length === 0) {
      const descFiltro = q ? `para "<strong>${escSisreg(q)}</strong>"` : 'para os filtros selecionados (Idade / Tipo / 1ª Vez ou Retorno)';
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align:center;padding:20px;color:#9a3412;background:#fff7ed;font-weight:800;">
            ⚠️ Nenhum procedimento encontrado ${descFiltro}.<br>
            <span style="font-size:12px;">Tente ajustar os filtros ou procure o <strong>${escSisreg(SISREG_CONTATO_FALLBACK)}</strong>.</span>
          </td>
        </tr>
      `;
      return;
    }

    _modalMedState.resultadosBusca = lista;
    tbody.innerHTML = lista.map((p, idx) => {
      const hierNorm = normSisregFront(p.hierarchy || '');
      const ehExame = normSisregFront(p.type) === 'exame';
      const ehLab = ehExame && /patologia clinica|exames de laboratorio|exame laboratorial/.test(hierNorm);
      const btnLabel = ehLab ? '🧪 Form. Exames' : (ehExame ? '📋 Exame na Ficha' : '📝 Usar na Ficha');
      return `
      <tr>
        <td><code class="sisreg-code-badge">${escSisreg(p.code || '—')}</code></td>
        <td style="font-weight:800;color:#0f172a;">${escSisreg(p.name)}</td>
        <td><span class="sisreg-type-tag ${normSisregFront(p.type)}">${escSisreg(p.type)}</span></td>
        <td style="font-size:11.5px;color:#1e3a8a;font-weight:700;">${escSisreg(p.hierarchy || '—')}</td>
        <td style="text-align:right;white-space:nowrap;">
          <button type="button" class="btn btn-outline btn-sm" onclick="copiarProcedimentoByInfo('${encodeURIComponent(p.name + ' (' + p.code + ')')}','Procedimento SISREG')">📋 Copiar</button>
          <button type="button" class="btn btn-primary btn-sm" onclick="usarResultadoModalMedNaFicha(${idx})">${btnLabel}</button>
        </td>
      </tr>
    `;
    }).join('');
  }

  function buscarAtalhoModalSisregMedico(termo) {
    const inp = document.getElementById('sm-busca-input');
    if (inp) {
      inp.value = termo;
      executarBuscaModalSisregMedico();
    }
  }

  function usarResultadoModalMedNaFicha(idx) {
    const proc = _modalMedState.resultadosBusca[idx];
    if (!proc) return;
    fecharModalSisregMedico();
    if (typeof window.aplicarProcedimentoSisregNaFicha === 'function') {
      window.aplicarProcedimentoSisregNaFicha(proc, _modalMedState.setor, _modalMedState.dados);
    } else {
      copiarTextoSisreg(`${proc.name} (${proc.code})`, 'Procedimento');
    }
  }

  function aplicarTransformModalMedImg() {
    const img = document.getElementById('sm-stage-img');
    if (img) {
      img.style.transform = `translate(${_modalMedState.panX}px, ${_modalMedState.panY}px) scale(${_modalMedState.zoom}) rotate(${_modalMedState.rot}deg)`;
    }
  }

  function zoomModalMedImg(d) {
    _modalMedState.zoom = Math.max(0.5, Math.min(4.5, Number((_modalMedState.zoom + d).toFixed(2))));
    aplicarTransformModalMedImg();
  }
  function girarModalMedImg() {
    _modalMedState.rot = (_modalMedState.rot + 90) % 360;
    aplicarTransformModalMedImg();
  }
  function resetModalMedImgView() {
    _modalMedState.zoom = 1; _modalMedState.rot = 0; _modalMedState.panX = 0; _modalMedState.panY = 0;
    aplicarTransformModalMedImg();
  }

  function inicializarPanZoomModalMedico() {
    if (typeof window.initPreviaPanZoom !== 'function') return;
    window.initPreviaPanZoom(
      'sm-img-stage',
      'sm-stage-img',
      () => _modalMedState,
      (patch) => { Object.assign(_modalMedState, patch); },
      aplicarTransformModalMedImg
    );
  }

  async function processarArquivoModalSisregMedico(fileList) {
    const file = (fileList || [])[0];
    if (!file) return;
    const statusEl = document.getElementById('sm-ocr-status');
    const imgEl = document.getElementById('sm-stage-img');
    const pdfFrame = document.getElementById('sm-stage-pdf-iframe');
    const emptyEl = document.getElementById('sm-stage-empty');
    revogarMedPdfBlobUrl();
    try {
      let b64 = '';
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        _modalMedState.arquivoTipo = 'pdf';
        _modalMedState.pdfNome = file.name;
        b64 = await lerPdfBase64(file);
        if (imgEl) imgEl.style.display = 'none';
        if (emptyEl) emptyEl.style.display = 'none';
        if (pdfFrame) {
          const blobUrl = criarBlobUrlPdfSisreg(b64);
          _medPdfBlobUrl = blobUrl;
          pdfFrame.src = blobUrl || b64;
          pdfFrame.style.display = 'block';
        }
      } else {
        _modalMedState.arquivoTipo = 'image';
        b64 = await comprimirImagemSisreg(file);
        _modalMedState.imgBase64 = b64;
        resetModalMedImgView();
        if (pdfFrame) { pdfFrame.src = 'about:blank'; pdfFrame.style.display = 'none'; }
        if (imgEl) { imgEl.src = b64; imgEl.style.display = 'block'; }
        if (emptyEl) emptyEl.style.display = 'none';
      }

      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.className = 'pr-status-box loading';
        statusEl.textContent = '⏳ Extraindo texto da ficha e conferindo no SISREG...';
      }
      const res = await fetch(`${getApiUrlBase()}/sisreg/analisar-ficha`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arquivo_base64: b64 })
      });
      const data = await res.json();
      if (data.ok && data.dados) {
        _modalMedState.dados = data.dados;
        _modalMedState.sugestoes = data.sugestoes_procedimentos || [];
        incrementarContadorLidasHoje();
        if (statusEl) {
          statusEl.className = 'pr-status-box ok';
          statusEl.textContent = '✅ Leitura concluída! Copie o texto para o PEC ou transfira para a Ficha Ambulatorial.';
        }
        preencherCamposModalMedico();
        renderSugestoesModalMedico();
      } else if (statusEl) {
        statusEl.className = 'pr-status-box warn';
        statusEl.textContent = `⚠️ ${data.error || 'Não foi possível ler automaticamente.'}`;
      }
    } catch (err) {
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.className = 'pr-status-box warn';
        statusEl.textContent = `⚠️ ${err.message}`;
      }
    }
  }

  function preencherCamposModalMedico() {
    const d = _modalMedState.dados;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    set('sm-pac-nome', d.paciente_nome);
    set('sm-pac-cns', d.paciente_cns);
    set('sm-pac-tel', d.paciente_telefone);
    set('sm-pac-esp', d.especialidade_ou_exame);
    set('sm-pac-cid', d.cid10);
    set('sm-pac-hip', d.hipotese_diagnostica);
    set('sm-pac-obs', d.observacoes_revisada || d.observacoes_original);
    atualizarDestaqueConferirModalMedico();
    const alertEl = document.getElementById('sm-alertas-box');
    if (alertEl) {
      const endInfo = verificarEnderecoRecifeFront({
        municipio: d.paciente_municipio,
        uf: d.paciente_uf,
        cep: d.paciente_cep,
        endereco: d.paciente_endereco
      });
      const avisos = [];
      if (endInfo.status === 'fora_recife') avisos.push(`<div class="sisreg-alert-banner danger">${escSisreg(endInfo.alerta)}</div>`);
      if (Array.isArray(d.alertas_digitacao) && d.alertas_digitacao.length) {
        avisos.push(`<div class="sisreg-alert-banner info">🧹 ${escSisreg(d.alertas_digitacao.join(' · '))}</div>`);
      }
      alertEl.innerHTML = avisos.join('');
    }
  }

  function renderSugestoesModalMedico() {
    const box = document.getElementById('sm-sugestoes-box');
    if (!box) return;
    const sugs = _modalMedState.sugestoes || [];
    if (!sugs.length) {
      box.innerHTML = `<div class="sisreg-muted">Ao anexar a foto da ficha, mostraremos aqui se o procedimento existe no SISREG.</div>`;
      return;
    }
    box.innerHTML = sugs.map(g => {
      if (!g.resultados || g.resultados.length === 0) {
        return `<div class="sisreg-match-miss"><span>⚠️ <b>${escSisreg(g.termo)}</b> não encontrado na tabela local — procure o <b>${escSisreg(SISREG_CONTATO_FALLBACK)}</b>.</span></div>`;
      }
      return g.resultados.slice(0, 3).map(p => `
        <div class="sisreg-match-item top">
          <div style="display:flex;justify-content:space-between;gap:6px;flex-wrap:wrap;align-items:center;">
            <div><code class="sisreg-code-badge">${escSisreg(p.code)}</code> <strong style="font-size:12px;">${escSisreg(p.name)}</strong></div>
            <button type="button" class="btn btn-primary btn-sm" onclick="aplicarProcedimentoSisregExterno('${encodeURIComponent(p.name)}','${encodeURIComponent(p.code)}','${encodeURIComponent(p.type || '')}','${encodeURIComponent(p.hierarchy || '')}')">📝 Usar</button>
          </div>
          <div class="sisreg-hier-path">📍 ${escSisreg(p.hierarchy)}</div>
        </div>
      `).join('');
    }).join('');
  }

  function aplicarProcedimentoSisregExterno(encName, encCode, encType, encHier) {
    const proc = {
      name: decodeURIComponent(encName || ''),
      code: decodeURIComponent(encCode || ''),
      type: decodeURIComponent(encType || ''),
      hierarchy: decodeURIComponent(encHier || '')
    };
    const d = {
      ..._modalMedState.dados,
      paciente_nome: document.getElementById('sm-pac-nome')?.value.trim() || _modalMedState.dados.paciente_nome,
      paciente_cns: document.getElementById('sm-pac-cns')?.value.trim() || _modalMedState.dados.paciente_cns,
      paciente_telefone: document.getElementById('sm-pac-tel')?.value.trim() || _modalMedState.dados.paciente_telefone,
      hipotese_diagnostica: document.getElementById('sm-pac-hip')?.value.trim() || _modalMedState.dados.hipotese_diagnostica,
      cid10: document.getElementById('sm-pac-cid')?.value.trim() || _modalMedState.dados.cid10,
      observacoes_revisada: document.getElementById('sm-pac-obs')?.value.trim() || _modalMedState.dados.observacoes_revisada
    };
    fecharModalSisregMedico();
    if (typeof window.aplicarProcedimentoSisregNaFicha === 'function') {
      window.aplicarProcedimentoSisregNaFicha(proc, _modalMedState.setor, d);
    }
  }

  function transferirLeituraModalMedParaFicha() {
    const procNome = document.getElementById('sm-pac-esp')?.value.trim() || '';
    const d = {
      ..._modalMedState.dados,
      paciente_nome: document.getElementById('sm-pac-nome')?.value.trim() || '',
      paciente_cns: document.getElementById('sm-pac-cns')?.value.trim() || '',
      paciente_telefone: document.getElementById('sm-pac-tel')?.value.trim() || '',
      especialidade_ou_exame: procNome,
      hipotese_diagnostica: document.getElementById('sm-pac-hip')?.value.trim() || '',
      cid10: document.getElementById('sm-pac-cid')?.value.trim() || '',
      observacoes_revisada: document.getElementById('sm-pac-obs')?.value.trim() || ''
    };
    fecharModalSisregMedico();
    if (typeof window.aplicarProcedimentoSisregNaFicha === 'function') {
      window.aplicarProcedimentoSisregNaFicha({ name: procNome, code: '' }, _modalMedState.setor, d);
    }
  }

  // CTRL+V GLOBAL PARA MODAL REGULAÇÃO E MODAL MÉDICO
  document.addEventListener('paste', (e) => {
    const modalMed = document.getElementById('modal-sisreg-medico');
    const modalMedAberto = modalMed && modalMed.classList.contains('show') && _modalMedState.aba === 'leitor';
    const modalReg = document.getElementById('modal-previa-regulacao');
    const modalRegAberto = modalReg && modalReg.classList.contains('show') && _sisregAbaAtiva === 'leitor';
    const modalCaptura = document.getElementById('modal-captura-receita')?.classList.contains('show');
    if (modalCaptura || (!modalMedAberto && !modalRegAberto)) return;

    const items = e.clipboardData?.items || [];
    const files = [];
    for (const it of items) {
      if (it.type && (it.type.startsWith('image/') || it.type === 'application/pdf')) {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      if (modalMedAberto) processarArquivoModalSisregMedico(files);
      else processarArquivosCopilotoSisreg(files);
    }
  });

  // Expor funções globais usadas nos handlers HTML/JS
  window.initCopilotoRegulacao = initCopilotoRegulacao;
  window.abrirModalPreviaRegulacao = abrirModalPreviaRegulacao;
  window.fecharModalPreviaRegulacao = fecharModalPreviaRegulacao;
  window.toggleCorpoCopilotoRegulacao = toggleCorpoCopilotoRegulacao;
  window.trocarAbaCopilotoRegulacao = trocarAbaCopilotoRegulacao;
  window.processarArquivosCopilotoSisreg = processarArquivosCopilotoSisreg;
  window.reanalisarAnexoAtivoCopiloto = reanalisarAnexoAtivoCopiloto;
  window.limparFichaCopilotoSisreg = limparFichaCopilotoSisreg;
  window.desvincularPacienteCopiloto = desvincularPacienteCopiloto;
  window.navegarFotoCopiloto = navegarFotoCopiloto;
  window.selecionarFotoCopiloto = selecionarFotoCopiloto;
  window.zoomCopilotoImg = zoomCopilotoImg;
  window.girarCopilotoImg = girarCopilotoImg;
  window.resetCopilotoImgView = resetCopilotoImgView;
  window.onCampoSisregAlterado = onCampoSisregAlterado;
  window.onInputTelefoneSisreg = onInputTelefoneSisreg;
  window.onToggleTelConferidoSisreg = onToggleTelConferidoSisreg;
  window.onToggleMaiusculasObs = onToggleMaiusculasObs;
  window.alternarTextoOriginalObsSisreg = alternarTextoOriginalObsSisreg;
  window.copiarTelefoneSoDigitos = copiarTelefoneSoDigitos;
  window.copiarCampoSisreg = copiarCampoSisreg;
  window.copiarObservacaoSisreg = copiarObservacaoSisreg;
  window.copiarObsModalMedicoSisreg = copiarObsModalMedicoSisreg;
  window.focarTrechoConferirSisreg = focarTrechoConferirSisreg;
  window.removerMarcacoesConferirSisreg = removerMarcacoesConferirSisreg;
  window.atualizarDestaqueConferirObsSisreg = atualizarDestaqueConferirObsSisreg;
  window.atualizarDestaqueConferirModalMedico = atualizarDestaqueConferirModalMedico;
  window.REGEX_CONFERIR_SISREG = REGEX_CONFERIR_SISREG;
  window.confirmarCopiaComConferir = confirmarCopiaComConferir;
  window.abrirDeclResidenciaDoCopiloto = abrirDeclResidenciaDoCopiloto;
  window.rebuscarProcedimentosCopiloto = rebuscarProcedimentosCopiloto;
  window.copiarProcedimentoByInfo = copiarProcedimentoByInfo;
  window.abrirBuscaComTermo = abrirBuscaComTermo;
  window.buscarAtalhoSisreg = buscarAtalhoSisreg;
  window.executarBuscaManualSisreg = executarBuscaManualSisreg;
  window.importarNovaTabelaSisreg = importarNovaTabelaSisreg;
  window.abrirPacienteNoCopilotoSisreg = abrirPacienteNoCopilotoSisreg;
  window.salvarFotoCopilotoNoPaciente = salvarFotoCopilotoNoPaciente;
  window.preencherDevolucaoDaFichaAtual = preencherDevolucaoDaFichaAtual;
  window.onDevMotivoChange = onDevMotivoChange;
  window.onDevSetorDestinoChange = onDevSetorDestinoChange;
  window.onDevFiltroListaChange = onDevFiltroListaChange;
  window.filtrarDevolucoesSisreg = filtrarDevolucoesSisreg;
  window.carregarDevolucoesSisreg = carregarDevolucoesSisreg;
  window.salvarNovaDevolucaoSisreg = salvarNovaDevolucaoSisreg;
  window.alternarStatusDevolucaoSisreg = alternarStatusDevolucaoSisreg;
  window.excluirDevolucaoSisreg = excluirDevolucaoSisreg;
  window.abrirSolucaoInlineRegulacao = abrirSolucaoInlineRegulacao;
  window.salvarSolucaoInlineRegulacao = salvarSolucaoInlineRegulacao;
  window.avisarProfissionalDevolucaoChat = avisarProfissionalDevolucaoChat;
  window.avisarMedicoDevolucaoChat = avisarMedicoDevolucaoChat;
  window.exportarDevolucoesSisregPDF = exportarDevolucoesSisregPDF;
  window.abrirModalDevolucoesProfissional = abrirModalDevolucoesProfissional;
  window.fecharModalDevolucoesProfissional = fecharModalDevolucoesProfissional;
  window.trocarSetorModalDevProf = trocarSetorModalDevProf;
  window.trocarFiltroModalDevProf = trocarFiltroModalDevProf;
  window.onBuscaModalDevProfInput = onBuscaModalDevProfInput;
  window.aplicarAtalhoSolucaoDevProf = aplicarAtalhoSolucaoDevProf;
  window.exportarDevolucoesProfissionalPDF = exportarDevolucoesProfissionalPDF;
  window.salvarSolucaoModalProfissional = salvarSolucaoModalProfissional;
  window.abrirModalSisregConsulta = abrirModalSisregConsulta;
  window.abrirModalSisregLeitor = abrirModalSisregLeitor;
  window.fecharModalSisregMedico = fecharModalSisregMedico;
  window.trocarAbaModalSisregMedico = trocarAbaModalSisregMedico;
  window.executarBuscaModalSisregMedico = executarBuscaModalSisregMedico;
  window.buscarAtalhoModalSisregMedico = buscarAtalhoModalSisregMedico;
  window.usarResultadoModalMedNaFicha = usarResultadoModalMedNaFicha;
  window.zoomModalMedImg = zoomModalMedImg;
  window.girarModalMedImg = girarModalMedImg;
  window.resetModalMedImgView = resetModalMedImgView;
  window.processarArquivoModalSisregMedico = processarArquivoModalSisregMedico;
  window.aplicarProcedimentoSisregExterno = aplicarProcedimentoSisregExterno;
  window.transferirLeituraModalMedParaFicha = transferirLeituraModalMedParaFicha;
  window.copiarTextoSisreg = copiarTextoSisreg;
})();
