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
  const _devProfModalState = { setor: 'Médico', profissional: '', status: 'pendente', busca: '' };
  let _devNovoAnexo = { base64: null, tipo: null, nome: '', bytes: 0 };
  const _cacheAnexosDev = {};
  let _devVisualizadorState = { id: null, zoom: 1, rot: 0, panX: 0, panY: 0, pdfBlobUrl: null };
  let _devolucaoAlvoBuscaId = null;
  let _salvandoSolucaoDevId = null;
  let _copilotoPdfBlobUrl = null;
  let _medPdfBlobUrl = null;

  const PROFISSIONAIS_DEVOLUCAO_POR_SETOR = {
    'Médico': ['Dr. Israel Christian', 'Dr. Joene Halan', 'Dra. Mirela Mota'],
    'Enfermagem': ['Mariana Vaz', 'Jorge Marcio', 'Lucelia de Abreu', 'Renata Célia'],
    'Odontologia': ['Dra. Juliana Cavalcante'],
    'ACS': [
      'Ana Paula', 'Ana Lúcia', 'Lenilda', 'Conceição', 'Joselita',
      'Alda', 'Simone', 'Patrícia', 'Telma', 'Jeane',
      'Josélia', 'Arlinda', 'Nena', 'Rosilene', 'Fátima'
    ]
  };

  window.atualizarProfissionaisSisregDinamicos = function (porSetor) {
    if (!porSetor || typeof porSetor !== 'object') return;
    ['Médico', 'Enfermagem', 'Odontologia'].forEach((setor) => {
      if (Array.isArray(porSetor[setor]) && porSetor[setor].length > 0) {
        PROFISSIONAIS_DEVOLUCAO_POR_SETOR[setor] = [...new Set(porSetor[setor])];
      }
    });
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
    anexos: [],
    anexoIdx: 0,
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

  function formatarTagProvedorSisreg(data) {
    const modelRaw = String(data?.model || '').trim();
    const isGroq = data?.provider === 'groq' || /^groq\//i.test(modelRaw);
    return isGroq ? '(Groq)' : '(Gemini)';
  }

  function renderBannerReceitaNoSisreg(statusEl, alertaReceita, tagProvedor = '') {
    if (!statusEl || !alertaReceita || !alertaReceita.eh_receita) return false;
    const fila = alertaReceita.fila_destino || 'Médico';
    const badge = fila === 'Enfermagem'
      ? '<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#dcfce7;color:#166534;font-weight:900;">🟢 Enfermeiro pode fazer (Enfermagem)</span>'
      : fila === 'Odontologia'
        ? '<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#e0f2fe;color:#075985;font-weight:900;">🦷 Dentista (Odontologia)</span>'
        : '<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#dbeafe;color:#1e40af;font-weight:900;">🔵 Somente Médico pode fazer</span>';
    const motivo = alertaReceita.motivo_profissional ? `<div>${escSisreg(alertaReceita.motivo_profissional)}</div>` : '';
    const perfilHtml = alertaReceita.perfil_clinico?.label ? `<div><b>Perfil:</b> ${escSisreg(alertaReceita.perfil_clinico.label)}</div>` : '';
    const meds = alertaReceita.medicamentos ? `<div><b>Medicamentos:</b> ${escSisreg(alertaReceita.medicamentos)}</div>` : '';
    const regra = alertaReceita.regra_validade ? ` · ${escSisreg(alertaReceita.regra_validade)}` : '';
    const urgMap = { vencida: ' (Vencida)', urgente: ` (Vence em ${alertaReceita.dias_restantes}d)`, normal: ` (Válida - ${alertaReceita.dias_restantes}d)` };
    const urgTxt = alertaReceita.dias_restantes !== null && alertaReceita.dias_restantes !== undefined ? (urgMap[alertaReceita.urgencia] || '') : '';
    const venc = alertaReceita.data_vencimento ? `<div><b>Validade:</b> ${escSisreg(alertaReceita.data_vencimento)}${urgTxt}${regra}</div>` : '';
    const saldoHtml = alertaReceita.saldo_comprimidos?.resumo ? `<div><b>Comprimidos:</b> ${escSisreg(alertaReceita.saldo_comprimidos.resumo)}</div>` : '';
    const prov = tagProvedor ? ` <span style="color:#64748b;font-weight:700;">${escSisreg(tagProvedor)}</span>` : '';
    statusEl.style.display = 'block';
    statusEl.className = 'pr-status-box warn';
    statusEl.innerHTML = `<div style="display:flex;flex-direction:column;gap:4px;">
      <div><strong>💊 Este documento é uma RECEITA (não é ficha do SISREG).</strong>${prov}</div>
      <div>${badge}</div>
      ${perfilHtml}${motivo}${meds}${venc}${saldoHtml}
    </div>`;
    return true;
  }

  async function fetchJsonSisregComTimeout(url, options = {}, timeoutMs = 42000) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await fetch(url, {
        ...options,
        signal: controller ? controller.signal : undefined
      });
      const txt = await res.text();
      let data = {};
      try { data = txt ? JSON.parse(txt) : {}; } catch (_) {
        data = { ok: false, error: `Resposta inválida do servidor (HTTP ${res.status}).` };
      }
      return { res, data };
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw new Error('Tempo limite excedido ao analisar imagem (42s). Foto mantida — tente novamente em alguns segundos.');
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function exibirStatusErroOcrComRetry(statusEl, msg, retryFnName) {
    if (!statusEl) return;
    statusEl.style.display = 'block';
    statusEl.className = 'pr-status-box warn';
    statusEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
      <span>⚠️ ${escSisreg(msg)}</span>
      <button type="button" class="btn btn-outline btn-sm" style="background:#fff;border-color:#d97706;color:#92400e;font-weight:800;" onclick="${retryFnName}()">🔄 Tentar ler novamente</button>
    </div>`;
  }

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
      status_documento_sisreg: '',
      documento_devolvido: false,
      historico_observacoes: [],
      observacao_solicitante: '',
      parecer_regulador: '',
      data_devolucao_regulador: '',
      nome_regulador: '',
      paciente_nome: '',
      paciente_cns: '',
      paciente_cpf: '',
      paciente_rg: '',
      paciente_dn: '',
      paciente_sexo: '',
      paciente_mae: '',
      paciente_telefone: '',
      paciente_endereco: '',
      paciente_numero: '',
      paciente_complemento: '',
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

  function verificarEnderecoRecifeFront({ municipio, uf, cep, endereco, bairro }) {
    const munNorm = normSisregFront(municipio);
    const ufNorm = normSisregFront(uf);
    const endNorm = normSisregFront(endereco);
    const bairroNorm = normSisregFront(bairro);
    const ehBairroUsf = /(?:^|[\s,])(?:cacote|areias?|estancias?)(?:$|[\s,])/.test(bairroNorm) ||
      /(?:^|[\s,])(?:cacote|areias?|estancias?)(?:$|[\s,])/.test(endNorm);
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
    if (!munNorm && cepDigits.length !== 8 && !endNorm && !ehBairroUsf) {
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
  function comprimirImagemViaObjectUrl(file, maxDim = 1350, quality = 0.80) {
    return new Promise((resolve, reject) => {
      const objUrl = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : null;
      if (!objUrl) {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Falha ao ler imagem'));
        reader.onload = (ev) => resolve(ev.target.result);
        reader.readAsDataURL(file);
        return;
      }
      const img = new Image();
      let done = false;
      const finish = (cb) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { URL.revokeObjectURL(objUrl); } catch (_) {}
        cb();
      };
      const timer = setTimeout(() => {
        finish(() => reject(new Error('Tempo esgotado ao carregar foto da câmera.')));
      }, 12000);
      img.onerror = () => finish(() => reject(new Error('Não foi possível ler a imagem capturada.')));
      img.onload = () => {
        finish(() => {
          try {
            let w = img.naturalWidth || img.width || maxDim;
            let h = img.naturalHeight || img.height || maxDim;
            if (w > maxDim || h > maxDim) {
              if (w > h) { h = Math.round(h * (maxDim / w)); w = maxDim; }
              else { w = Math.round(w * (maxDim / h)); h = maxDim; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            let out = canvas.toDataURL('image/jpeg', quality);
            if (out.length > 2_000_000) {
              out = canvas.toDataURL('image/jpeg', 0.58);
            }
            canvas.width = 0;
            canvas.height = 0;
            resolve(out);
          } catch (err) {
            reject(err);
          }
        });
      };
      img.src = objUrl;
    });
  }

  function comprimirImagemSisreg(file) {
    return comprimirImagemViaObjectUrl(file, 1350, 0.80);
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
          <button type="button" class="pec-form-btn devolucao" onclick="abrirModalPreviaRegulacao('devolucoes','pendente')" title="Pendências aguardando resposta dos profissionais/ACS">↩️ Devoluções <span id="sisreg-dev-badge-bar" class="sisreg-dev-count" style="display:none;">0</span></button>
          <button type="button" class="pec-form-btn positivo" onclick="abrirModalPreviaRegulacao('devolucoes','respondida')" title="Ver pendências já respondidas pelos profissionais/ACS prontas para corrigir no SISREG">✅ Respondidas <span id="sisreg-resp-badge-bar" class="sisreg-dev-count resp" style="display:none;">0</span></button>
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
            <button type="button" class="sisreg-tab-btn ${_sisregAbaAtiva === 'devolucoes' && _sisregDevFiltro !== 'respondida' ? 'active' : ''}" id="sisreg-tab-devolucoes" onclick="trocarAbaCopilotoRegulacao('devolucoes','pendente')">↩️ Devoluções <span id="sisreg-dev-badge" class="sisreg-dev-count" style="display:none;">0</span></button>
            <button type="button" class="sisreg-tab-btn respondidas ${_sisregAbaAtiva === 'devolucoes' && _sisregDevFiltro === 'respondida' ? 'active' : ''}" id="sisreg-tab-respondidas" onclick="trocarAbaCopilotoRegulacao('devolucoes','respondida')">✅ Respondidas <span id="sisreg-resp-badge" class="sisreg-dev-count resp" style="display:none;">0</span></button>
          </div>

          <!-- ABA 1: PRÉVIA / LEITOR DE FICHA E PDF -->
          <div id="sisreg-pane-leitor" style="${_sisregAbaAtiva === 'leitor' ? '' : 'display:none;'}">
            <div class="sisreg-toolbar">
              <input type="file" id="sisreg-file-cam" accept="image/*" capture="environment" style="display:none;" onchange="const fl=this.files?Array.from(this.files):[];this.value='';if(fl.length)processarArquivosCopilotoSisreg(fl);">
              <input type="file" id="sisreg-file-upload" accept="image/*,application/pdf" multiple style="display:none;" onchange="const fl=this.files?Array.from(this.files):[];this.value='';if(fl.length)processarArquivosCopilotoSisreg(fl);">
              <button type="button" id="sisreg-btn-cam" class="btn btn-primary btn-sm" onclick="document.getElementById('sisreg-file-cam').click()">📸 Tirar Foto da Ficha</button>
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
                  <div id="sr-historico-obs-box" style="display:none;margin-bottom:8px;"></div>
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
                      <label>Cartão SUS (CNS) <span id="sr-cns-badge" class="sisreg-inline-badge"></span></label>
                      <div class="sisreg-inp-copy">
                        <input type="text" id="sr-cns" placeholder="15 dígitos" oninput="onCampoSisregAlterado('paciente_cns', this.value)">
                        <button type="button" onclick="copiarCampoSisreg('sr-cns','CNS')" title="Copiar CNS">📋</button>
                      </div>
                    </div>
                    <div class="sisreg-field">
                      <label>CPF</label>
                      <div class="sisreg-inp-copy">
                        <input type="text" id="sr-cpf" placeholder="000.000.000-00" oninput="onCampoSisregAlterado('paciente_cpf', this.value)">
                        <button type="button" onclick="copiarCampoSisreg('sr-cpf','CPF')" title="Copiar CPF">📋</button>
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
                      <label>Logradouro / Endereço</label>
                      <input type="text" id="sr-endereco" oninput="onCampoSisregAlterado('paciente_endereco', this.value)">
                    </div>
                    <div class="sisreg-field">
                      <label>Bairro (Caçote / Areias / Estância)</label>
                      <input type="text" id="sr-bairro" list="bairros-usf-list" placeholder="Caçote, Areias ou Estância" oninput="onCampoSisregAlterado('paciente_bairro', this.value)">
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
            <div class="sisreg-dev-form" id="sisreg-dev-form-wrap">
              <div style="font-size:12.5px;font-weight:900;color:#1e3a8a;margin-bottom:8px;">↩️ Registrar e Direcionar Devolução no SISREG</div>
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
                <input type="file" id="dev-file-cam" accept="image/*" capture="environment" style="display:none;" onchange="const fl=this.files?Array.from(this.files):[];this.value='';if(fl.length)processarArquivosNovaDevolucao(fl);">
                <input type="file" id="dev-file-upload" accept="image/*,application/pdf" style="display:none;" onchange="const fl=this.files?Array.from(this.files):[];this.value='';if(fl.length)processarArquivosNovaDevolucao(fl);">
                <button type="button" class="btn btn-outline btn-sm" onclick="document.getElementById('dev-file-cam').click()" title="Tirar foto da ficha/espelho SISREG">📸 Foto</button>
                <button type="button" class="btn btn-outline btn-sm" onclick="document.getElementById('dev-file-upload').click()" title="Anexar foto ou PDF (ou use Ctrl+V)">📎 Foto/PDF (Ctrl+V)</button>
                <span id="dev-anexo-preview-pill" style="display:none;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;background:#dbeafe;color:#1e40af;font-size:11.5px;font-weight:800;"></span>
              </div>
              <details id="dev-detalhes-box" style="margin-top:8px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:7px 10px;">
                <summary style="cursor:pointer;font-size:12px;font-weight:800;color:#1e3a8a;">📋 Detalhes do Erro / Dados da Ficha (para conferência do Médico / ACS)</summary>
                <div class="sisreg-dev-grid" style="margin-top:8px;">
                  <input type="text" id="dev-det-cns" placeholder="CNS / CPF do paciente">
                  <input type="text" id="dev-det-dn" placeholder="Data Nasc. (DD/MM/AAAA)">
                  <input type="text" id="dev-det-endereco" placeholder="Endereço / Bairro / CEP na ficha">
                  <input type="text" id="dev-det-cid" placeholder="CID-10">
                  <input type="text" id="dev-det-just" placeholder="Justificativa clínica escrita na ficha">
                  <input type="text" id="dev-det-motivo-central" placeholder="Texto exato da devolução da Central SISREG">
                </div>
              </details>
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap;">
                <label style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:800;color:#1e3a8a;cursor:pointer;">
                  <input type="checkbox" id="dev-enviar-chat"> 💬 Avisar também no Chat Interno (opcional · ⏳ Prazo padrão: 3 dias)
                </label>
                <button type="button" class="btn btn-primary btn-sm" onclick="salvarNovaDevolucaoSisreg()">➕ Registrar e Direcionar</button>
              </div>
            </div>
            <div id="sisreg-resp-banner" style="display:none;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;background:#ecfdf5;border:1.5px solid #6ee7b7;border-radius:10px;padding:10px 12px;color:#065f46;font-size:12.5px;font-weight:800;">
              <span>✅ Pendências respondidas pelos profissionais/ACS — confira a solução, corrija no SISREG e clique em <b>✅ Corrigida</b>.</span>
              <button type="button" class="btn btn-outline btn-sm" style="background:#fff;border-color:#6ee7b7;color:#065f46;font-weight:800;" onclick="filtrarDevolucoesSisreg('pendente')">➕ Registrar Nova Devolução</button>
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
                <span id="dev-storage-pill" class="sisreg-stat-pill" style="background:#f1f5f9;color:#334155;border:1px solid #cbd5e1;font-size:11px;">📦 Anexos: 0 (0 KB)</span>
                <button type="button" class="btn btn-outline btn-sm" onclick="limparAnexosVencidosSisreg()" title="Apagar anexos já vencidos ou corrigidos para economizar banco">🧹 Limpar Vencidos</button>
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
    sincronizarModoAbaDevolucoes();
  }

  function sincronizarModoAbaDevolucoes() {
    const isDevAba = _sisregAbaAtiva === 'devolucoes';
    const isResp = isDevAba && _sisregDevFiltro === 'respondida';
    document.getElementById('sisreg-tab-devolucoes')?.classList.toggle('active', isDevAba && !isResp);
    document.getElementById('sisreg-tab-respondidas')?.classList.toggle('active', isResp);
    const formWrap = document.getElementById('sisreg-dev-form-wrap');
    if (formWrap) formWrap.style.display = isResp ? 'none' : '';
    const respBanner = document.getElementById('sisreg-resp-banner');
    if (respBanner) respBanner.style.display = isResp ? 'flex' : 'none';
    document.getElementById('sisreg-dev-lista')?.classList.toggle('expanded', isResp);
  }

  function abrirModalPreviaRegulacao(aba = 'leitor', subFiltroDev = null) {
    garantirModalPreviaRegulacaoMontado();
    const modal = document.getElementById('modal-previa-regulacao');
    if (!modal) return;
    trocarAbaCopilotoRegulacao(aba || 'leitor', subFiltroDev);
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

  function trocarAbaCopilotoRegulacao(aba, subFiltroDev = null) {
    _sisregAbaAtiva = aba;
    if (aba === 'devolucoes' && subFiltroDev) {
      _sisregDevFiltro = subFiltroDev;
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
    }
    ['leitor', 'busca'].forEach(k => {
      document.getElementById(`sisreg-tab-${k}`)?.classList.toggle('active', k === aba);
    });
    ['leitor', 'busca', 'devolucoes'].forEach(k => {
      const pane = document.getElementById(`sisreg-pane-${k}`);
      if (pane) pane.style.display = k === aba ? 'block' : 'none';
    });
    sincronizarModoAbaDevolucoes();
    if (aba === 'busca') {
      garantirCatalogoSisregCarregado().then(() => {
        executarBuscaManualSisreg();
        document.getElementById('sisreg-busca-input')?.focus();
      });
    } else if (aba === 'devolucoes') {
      _sisregDevolucoes = aplicarFiltrosDevolucoesLista(_sisregDevolucoesTodas, _sisregDevFiltro, _sisregDevSetorFiltro, _sisregDevBusca);
      renderDevolucoesSisreg();
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
  function atualizarBotaoCameraCopiloto() {
    const btnCam = document.getElementById('sisreg-btn-cam');
    if (!btnCam) return;
    const qtd = _copilotoState.anexos.length;
    btnCam.textContent = qtd > 0
      ? `📸 + Tirar outra foto (${qtd}/6)`
      : '📸 Tirar Foto da Ficha';
  }

  async function processarArquivosCopilotoSisreg(fileList) {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;
    abrirModalPreviaRegulacao('leitor');

    const statusEl = document.getElementById('sisreg-ocr-status');
    const vagas = 6 - _copilotoState.anexos.length;
    if (vagas <= 0) {
      if (typeof showToast === 'function') showToast('Limite máximo de 6 arquivos atingido.', true);
      return;
    }

    const selecionados = files.slice(0, vagas);
    const novosAnexos = [];
    for (let i = 0; i < selecionados.length; i++) {
      const f = selecionados[i];
      const ehPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
      const ehImg = !f.type || f.type.startsWith('image/');
      if (!ehPdf && !ehImg) continue;
      try {
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.className = 'pr-status-box loading';
          statusEl.textContent = ehPdf ? '⏳ Preparando PDF...' : '⏳ Preparando foto capturada...';
        }
        const b64 = ehPdf ? await lerPdfBase64(f) : await comprimirImagemSisreg(f);
        const anexoObj = {
          id: `sr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}_${i + 1}`,
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
        novosAnexos.push({ b64, ehPdf, acumular: _copilotoState.anexos.length > 1 });
        renderVisualizadorCopiloto();
        atualizarBotaoCameraCopiloto();
        atualizarPillPacienteVinculado();
      } catch (err) {
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.className = 'pr-status-box warn';
          statusEl.textContent = `⚠️ ${err.message || 'Erro ao preparar arquivo.'}`;
        }
      }
    }

    for (let i = 0; i < novosAnexos.length; i++) {
      const item = novosAnexos[i];
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.className = 'pr-status-box loading';
        statusEl.textContent = item.ehPdf
          ? '⏳ Lendo PDF... aguarde alguns segundos.'
          : (novosAnexos.length > 1
            ? `⏳ Analisando arquivo ${i + 1} de ${novosAnexos.length}...`
            : '⏳ Analisando documento e cruzando com o SISREG...');
      }
      await executarAnaliseIaCopiloto(item.b64, statusEl, item.acumular);
    }

    if (novosAnexos.length === 0 && typeof showToast === 'function') {
      showToast('Envie fotos (JPG/PNG) ou PDFs até 2 MB.', true);
    }
  }

  function mesclarDadosSisreg(atual, novo, acumular) {
    const out = { ...atual };
    const chavesTexto = [
      'tipo_arquivo', 'codigo_solicitacao', 'status_documento_sisreg',
      'observacao_solicitante', 'parecer_regulador', 'data_devolucao_regulador', 'nome_regulador',
      'paciente_nome', 'paciente_cns', 'paciente_cpf', 'paciente_rg',
      'paciente_dn', 'paciente_sexo', 'paciente_mae', 'paciente_telefone',
      'paciente_endereco', 'paciente_numero', 'paciente_complemento', 'paciente_bairro', 'paciente_cep', 'paciente_municipio',
      'paciente_uf', 'tipo_vaga', 'risco', 'especialidade_ou_exame',
      'hipotese_diagnostica', 'cid10', 'medico_solicitante', 'crm_conselho', 'data_solicitacao'
    ];
    chavesTexto.forEach(k => {
      if (novo[k] && (!acumular || !out[k])) out[k] = novo[k];
    });
    if (typeof novo.documento_devolvido === 'boolean') {
      out.documento_devolvido = acumular ? (Boolean(out.documento_devolvido) || novo.documento_devolvido) : novo.documento_devolvido;
    }
    if (Array.isArray(novo.historico_observacoes)) {
      if (!acumular || !Array.isArray(out.historico_observacoes) || out.historico_observacoes.length === 0) {
        out.historico_observacoes = novo.historico_observacoes.slice();
      } else {
        const vistos = new Set(out.historico_observacoes.map(h => `${h.papel}|${h.data || ''}|${normSisregFront(h.texto)}`));
        novo.historico_observacoes.forEach(h => {
          const chave = `${h.papel}|${h.data || ''}|${normSisregFront(h.texto)}`;
          if (!vistos.has(chave)) {
            vistos.add(chave);
            out.historico_observacoes.push(h);
          }
        });
      }
    }
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
      const { data } = await fetchJsonSisregComTimeout(`${getApiUrlBase()}/sisreg/analisar-ficha`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arquivo_base64: base64Str })
      }, 42000);
      if (data.ok && data.dados) {
        _copilotoState.dados = mesclarDadosSisreg(_copilotoState.dados, data.dados, acumular);
        if (!acumular) _copilotoState.telefoneConferido = false;
        _copilotoState.sugestoes = Array.isArray(data.sugestoes_procedimentos) ? data.sugestoes_procedimentos : [];
        incrementarContadorLidasHoje();
        const tagProv = formatarTagProvedorSisreg(data);
        if (statusEl && !renderBannerReceitaNoSisreg(statusEl, data.alerta_receita, tagProv)) {
          statusEl.style.display = 'block';
          statusEl.className = 'pr-status-box ok';
          statusEl.textContent = `✅ Leitura concluída! Confira os alertas, o telefone e copie as observações para o SISREG. · ${tagProv}`;
        }
        renderEstadoFormularioCopiloto();
        rebuscarProcedimentosCopiloto();
      } else {
        exibirStatusErroOcrComRetry(
          statusEl,
          data.error || 'Leitura automática indisponível — imagem mantida para leitura manual.',
          'reanalisarAnexoAtivoCopiloto'
        );
      }
    } catch (err) {
      exibirStatusErroOcrComRetry(
        statusEl,
        `${err?.message || 'Falha de conexão na leitura automática.'} A foto permanece visível ao lado.`,
        'reanalisarAnexoAtivoCopiloto'
      );
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
    atualizarBotaoCameraCopiloto();
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
    setVal('sr-cpf', d.paciente_cpf);
    setVal('sr-dn', d.paciente_dn);
    setVal('sr-mae', d.paciente_mae);
    setVal('sr-telefone', d.paciente_telefone);
    setVal('sr-endereco', d.paciente_endereco);
    setVal('sr-bairro', d.paciente_bairro);
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
      const histParseado = parsearHistoricoObsTextoFront(valor);
      if (histParseado && histParseado.historico.length > 0) {
        _copilotoState.dados.historico_observacoes = histParseado.historico;
        if (histParseado.observacao_solicitante) _copilotoState.dados.observacao_solicitante = histParseado.observacao_solicitante;
        if (histParseado.parecer_regulador) _copilotoState.dados.parecer_regulador = histParseado.parecer_regulador;
        if (histParseado.data_devolucao_regulador) _copilotoState.dados.data_devolucao_regulador = histParseado.data_devolucao_regulador;
        if (histParseado.nome_regulador) _copilotoState.dados.nome_regulador = histParseado.nome_regulador;
        if (histParseado.documento_devolvido) {
          _copilotoState.dados.documento_devolvido = true;
          if (!_copilotoState.dados.status_documento_sisreg) _copilotoState.dados.status_documento_sisreg = 'DEVOLVIDO';
        }
      }
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

  function parsearHistoricoObsTextoFront(textoRaw) {
    const texto = String(textoRaw || '').trim();
    if (!texto || !/(?:solicitante|regulador)\s*:/i.test(texto)) return null;
    const marcadorRe = /(?:^|[\n\r])\s*(?:[-•*]\s*)?((?:operador\s+|unidade\s+|profissional\s+|medico\s+|médico\s+)?solicitante|(?:medico\s+|médico\s+)?regulador(?:\(a\))?|central\s+de\s+regulac[aã]o|central\s+regulador[a]?)\s*:/gi;
    const matches = [];
    let m;
    while ((m = marcadorRe.exec(texto)) !== null) {
      matches.push({ labelRaw: m[1], startMatch: m.index, afterColon: m.index + m[0].length });
    }
    if (!matches.length) return null;

    const historico = [];
    for (let i = 0; i < matches.length; i++) {
      const cur = matches[i];
      const end = i + 1 < matches.length ? matches[i + 1].startMatch : texto.length;
      const body = texto.slice(cur.afterColon, end).trim();
      const papel = normSisregFront(cur.labelRaw).includes('regulador') ? 'regulador' : 'solicitante';
      let data = null;
      let autor = null;
      let txtLimpo = body;
      const dm = body.match(/\bdata(?:\s+da\s+(?:analise|análise|devolucao|devolução|observacao|observação|solicitacao|solicitação))?\s*:\s*(\d{2}\/\d{2}\/\d{4}(?:\s+(?:às\s+|as\s+)?\d{2}:\d{2}(?::\d{2})?)?)/i);
      if (dm) {
        data = dm[1].trim();
        const antes = body.slice(0, dm.index).replace(/^[\s\-–:|]+|[\s\-–:|]+$/g, '').trim();
        const depois = body.slice(dm.index + dm[0].length).replace(/^[\s\-–:|]+|[\s\-–:|]+$/g, '').trim();
        if (antes && depois) {
          if (antes.length <= 65 && !/[.;!?]/.test(antes) && antes.split(/\s+/).length <= 6) {
            autor = antes;
            txtLimpo = depois;
          } else {
            txtLimpo = `${antes} ${depois}`.trim();
          }
        } else {
          txtLimpo = antes || depois || '';
        }
      }
      txtLimpo = txtLimpo.replace(/^(?:observa[çc][ãa]o|observa[çc][õo]es|justificativa|parecer|motivo)\s*:\s*/i, '').replace(/\s+/g, ' ').trim();
      if (txtLimpo || data || autor) historico.push({ papel, autor, data, texto: txtLimpo });
    }
    const sol = historico.filter(h => h.papel === 'solicitante' && h.texto).map(h => h.texto).join('\n');
    const regs = historico.filter(h => h.papel === 'regulador');
    const ultReg = regs[regs.length - 1] || null;
    const parecer = ultReg ? ultReg.texto : '';
    const parecerEhSoAut = /^(autorizad[oa]|agendad[oa]|aprovad[oa]|deferid[oa])\.?$/i.test(normSisregFront(parecer));
    return {
      historico,
      observacao_solicitante: sol,
      parecer_regulador: parecer,
      data_devolucao_regulador: ultReg ? (ultReg.data || '') : '',
      nome_regulador: ultReg ? (ultReg.autor || '') : '',
      documento_devolvido: Boolean((parecer && !parecerEhSoAut) || /\bdevolvid[oa]\b/i.test(normSisregFront(texto)))
    };
  }

  function usarObsSolicitanteNoCampoSisreg() {
    const d = _copilotoState.dados;
    const txt = (d.observacao_solicitante || '').trim();
    if (!txt) return;
    const ta = document.getElementById('sr-observacoes');
    if (ta) ta.value = formatarObservacaoFront(txt, _copilotoState.semAcentoMaiusculo);
    d.observacoes_revisada = txt;
    _copilotoState.verOriginal = false;
    atualizarDestaqueConferirObsSisreg();
    if (typeof showToast === 'function') showToast('📝 Observação do Solicitante aplicada no campo de cópia!');
  }

  function copiarParecerReguladorSisreg() {
    const d = _copilotoState.dados;
    const txt = [
      d.data_devolucao_regulador ? `Data: ${d.data_devolucao_regulador}` : '',
      d.nome_regulador ? `Regulador: ${d.nome_regulador}` : '',
      d.parecer_regulador || ''
    ].filter(Boolean).join(' · ');
    copiarTextoSisreg(txt, 'Parecer do Regulador');
  }

  function renderHistoricoObservacoesSisreg() {
    const box = document.getElementById('sr-historico-obs-box');
    if (!box) return;
    const d = _copilotoState.dados || {};
    const hist = Array.isArray(d.historico_observacoes) ? d.historico_observacoes.slice() : [];
    if (hist.length === 0 && !d.parecer_regulador && !d.observacao_solicitante && !d.documento_devolvido) {
      box.style.display = 'none';
      box.innerHTML = '';
      return;
    }

    if (d.observacao_solicitante && !hist.some(h => h.papel === 'solicitante')) {
      hist.unshift({ papel: 'solicitante', autor: d.medico_solicitante || '', data: d.data_solicitacao || '', texto: d.observacao_solicitante });
    }
    if (d.parecer_regulador && !hist.some(h => h.papel === 'regulador')) {
      hist.push({ papel: 'regulador', autor: d.nome_regulador || '', data: d.data_devolucao_regulador || '', texto: d.parecer_regulador });
    }

    const statusBadge = d.documento_devolvido
      ? `<span style="background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;padding:2px 8px;border-radius:999px;font-size:10.5px;font-weight:900;">↩️ DOCUMENTO DEVOLVIDO</span>`
      : `<span style="background:#dcfce7;color:#166534;border:1px solid #86efac;padding:2px 8px;border-radius:999px;font-size:10.5px;font-weight:900;">✅ ${escSisreg(d.status_documento_sisreg || 'Sem devolução do Regulador')}</span>`;

    const cardsHtml = hist.map(item => {
      const isReg = item.papel === 'regulador';
      const bg = isReg ? '#fef2f2' : '#f8fafc';
      const bd = isReg ? '#fca5a5' : '#cbd5e1';
      const titleColor = isReg ? '#991b1b' : '#1e3a8a';
      const roleLabel = isReg ? '🏛️ Regulador (Devolução / Parecer)' : '🩺 Solicitante';
      const metaParts = [];
      if (item.autor) metaParts.push(`<span>👤 ${escSisreg(item.autor)}</span>`);
      if (item.data) metaParts.push(`<span>📅 Data: <strong>${escSisreg(item.data)}</strong></span>`);
      const actionBtn = isReg
        ? `<button type="button" class="sisreg-mini-link" style="border-color:#fca5a5;color:#991b1b;" onclick="copiarParecerReguladorSisreg()">📋 Copiar</button>`
        : `<button type="button" class="sisreg-mini-link" onclick="usarObsSolicitanteNoCampoSisreg()">⬇️ Usar abaixo</button>`;
      return `
        <div style="background:${bg};border:1.5px solid ${bd};border-radius:9px;padding:8px 10px;margin-top:6px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;margin-bottom:4px;">
            <span style="font-size:11.5px;font-weight:900;color:${titleColor};">${roleLabel}</span>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;color:#475569;font-weight:700;">
              ${metaParts.join('')}
              ${actionBtn}
            </div>
          </div>
          <div style="font-size:12px;color:#0f172a;font-weight:600;line-height:1.45;white-space:pre-wrap;">${escSisreg(item.texto || '—')}</div>
        </div>
      `;
    }).join('');

    box.style.display = 'block';
    box.innerHTML = `
      <div style="background:#ffffff;border:1.5px solid ${d.documento_devolvido ? '#f87171' : '#bfdbfe'};border-radius:10px;padding:8px 10px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;">
          <span style="font-size:11.5px;font-weight:900;color:#0f172a;">🗂️ Histórico de Observações (SISREG III)</span>
          ${statusBadge}
        </div>
        ${cardsHtml}
      </div>
    `;
  }

  function atualizarValidacoesAoVivoCopiloto() {
    atualizarDestaqueConferirObsSisreg();
    renderHistoricoObservacoesSisreg();
    const d = _copilotoState.dados;
    const cnsInfo = validarCnsFront(d.paciente_cns);
    const telInfo = validarTelefoneFront(d.paciente_telefone);
    const idade = calcularIdadeFront(d.paciente_dn);
    const endInfo = verificarEnderecoRecifeFront({
      municipio: d.paciente_municipio,
      uf: d.paciente_uf,
      cep: d.paciente_cep,
      endereco: d.paciente_endereco,
      bairro: d.paciente_bairro
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
      if (d.documento_devolvido) {
        const dataDevTxt = d.data_devolucao_regulador ? ` · 📅 Data: <strong>${escSisreg(d.data_devolucao_regulador)}</strong>` : '';
        const nomeRegTxt = d.nome_regulador ? ` (${escSisreg(d.nome_regulador)})` : '';
        const parecerTxt = d.parecer_regulador
          ? `<div style="margin-top:4px;font-size:12px;color:#7f1d1d;"><strong>🏛️ Regulador${nomeRegTxt}:</strong> ${escSisreg(d.parecer_regulador)}</div>`
          : '';
        banners.push(`
          <div class="sisreg-alert-banner danger" style="align-items:flex-start;flex-direction:column;gap:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;width:100%;gap:8px;flex-wrap:wrap;">
              <div>
                <strong>↩️ DOCUMENTO DEVOLVIDO NO SISREG III</strong>${dataDevTxt}
                ${parecerTxt}
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                ${d.parecer_regulador ? `<button type="button" class="btn btn-sm" style="background:#fff;color:#991b1b;border:1px solid #fca5a5;font-weight:800;" onclick="copiarParecerReguladorSisreg()">📋 Copiar Parecer</button>` : ''}
                <button type="button" class="btn btn-sm" style="background:#dc2626;color:#fff;font-weight:900;white-space:nowrap;" onclick="preencherDevolucaoDaFichaAtual()">↩️ Direcionar Devolução</button>
              </div>
            </div>
          </div>
        `);
      }
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
          paciente_cpf: d.paciente_cpf || '',
          paciente_rg: d.paciente_rg || '',
          paciente_endereco: d.paciente_endereco || '',
          paciente_numero: d.paciente_numero || '',
          paciente_complemento: d.paciente_complemento || '',
          paciente_bairro: d.paciente_bairro || '',
          paciente_cep: d.paciente_cep || '',
          paciente_municipio: d.paciente_municipio || '',
          paciente_uf: d.paciente_uf || '',
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
          paciente_cpf: ext.paciente_cpf || '',
          paciente_rg: ext.paciente_rg || '',
          paciente_dn: ext.paciente_data_nascimento || '',
          paciente_sexo: ext.paciente_sexo || '',
          paciente_mae: ext.paciente_mae || '',
          paciente_telefone: ext.paciente_telefone || '',
          paciente_endereco: ext.paciente_endereco || '',
          paciente_numero: ext.paciente_numero || '',
          paciente_complemento: ext.paciente_complemento || '',
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
          status_documento_sisreg: ext.status_documento_sisreg || '',
          documento_devolvido: Boolean(ext.documento_devolvido),
          historico_observacoes: Array.isArray(ext.historico_observacoes) ? ext.historico_observacoes : [],
          observacao_solicitante: ext.observacao_solicitante || '',
          parecer_regulador: ext.parecer_regulador || '',
          data_devolucao_regulador: ext.data_devolucao_regulador || '',
          nome_regulador: ext.nome_regulador || '',
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
        status_documento_sisreg: d.status_documento_sisreg || null,
        documento_devolvido: Boolean(d.documento_devolvido),
        historico_observacoes: Array.isArray(d.historico_observacoes) ? d.historico_observacoes : [],
        observacao_solicitante: d.observacao_solicitante || null,
        parecer_regulador: d.parecer_regulador || null,
        data_devolucao_regulador: d.data_devolucao_regulador || null,
        nome_regulador: d.nome_regulador || null,
        alertas_digitacao: Array.isArray(d.alertas_digitacao) ? d.alertas_digitacao : [],
        paciente_cpf: d.paciente_cpf || null,
        paciente_rg: d.paciente_rg || null,
        paciente_endereco: d.paciente_endereco || null,
        paciente_numero: d.paciente_numero || null,
        paciente_complemento: d.paciente_complemento || null,
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
    if (/enferm|mariana vaz|jorge marcio|lucelia|renata celia|\bcoren\b/.test(p)) return 'Enfermagem';
    if (/\bacs\b|agente comunit|ana paula|ana lucia|lenilda|conceicao|joselita|alda|simone|patricia|telma|jeane|joselia|arlinda|nena|rosilene|fatima/.test(p)) {
      return 'ACS';
    }
    return 'Médico';
  }

  function limparProfDevFront(v) {
    const s = String(v || '').trim();
    if (!s || /^todos\b/i.test(normTxtDev(s))) return '';
    return s;
  }

  function pertenceAoProfissionalDevolucaoFront(item, setorAlvo = '', profAlvo = '') {
    if (!item || typeof item !== 'object') return false;
    const setorItem = item.setor_destino || inferirSetorPorMotivoEProfFront(item.motivo, item.profissional_equipe);
    const sAlvoNorm = normTxtDev(setorAlvo);
    if (sAlvoNorm && sAlvoNorm !== 'todos' && normTxtDev(setorItem) !== sAlvoNorm) {
      return false;
    }
    const profFiltro = normTxtDev(profAlvo);
    if (!profFiltro || profFiltro.startsWith('todos')) {
      return true;
    }
    const profItem = normTxtDev(item.profissional_equipe);
    if (!profItem || profItem.startsWith('todos')) {
      return true;
    }
    return profItem === profFiltro || profItem.includes(profFiltro) || profFiltro.includes(profItem);
  }

  function obterProfissionalAtivoTabSetorFront(setor) {
    const keyMap = { 'Médico': 'medico', 'Enfermagem': 'enfermagem', 'Odontologia': 'odontologia' };
    const k = keyMap[setor];
    if (!k) return '';
    const filtros = typeof sectorFilters !== 'undefined' ? sectorFilters : (window._usfSectorFilters || {});
    if (filtros && Object.prototype.hasOwnProperty.call(filtros, k)) {
      return filtros[k] || '';
    }
    const btnActive = document.querySelector(`#filter-bar-${k} .btn-filter.active`);
    if (btnActive && btnActive.dataset && typeof btnActive.dataset.prof === 'string') {
      return btnActive.dataset.prof;
    }
    return '';
  }

  function badgeDestinatarioDevHtml(item, setorItem) {
    const prof = limparProfDevFront(item?.profissional_equipe);
    if (prof) {
      return `<span class="sisreg-pill-mini" style="background:#eef2ff;color:#3730a3;border:1px solid #c7d2fe;">🎯 Para: ${escSisreg(prof)}</span>`;
    }
    return `<span class="sisreg-pill-mini" style="background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;">👥 Todos (${escSisreg(setorItem)})</span>`;
  }

  function popularSelectProfissionaisDevolucao(setor = 'Médico', selecionado = '') {
    const sel = document.getElementById('dev-profissional');
    if (!sel) return;
    const setorNorm = SETOR_DEV_META[setor] ? setor : 'Médico';
    const todosLabels = {
      'Médico': '👥 Todos os Médicos',
      'Enfermagem': '👥 Todos da Enfermagem',
      'Odontologia': '👥 Todos da Odontologia',
      'ACS': '👥 Todos os ACS'
    };
    const baseLista = PROFISSIONAIS_DEVOLUCAO_POR_SETOR[setorNorm] || [];
    const selNorm = normTxtDev(selecionado);
    let matched = '';
    if (selNorm && !selNorm.startsWith('todos')) {
      matched = baseLista.find(p => normTxtDev(p) === selNorm)
        || baseLista.find(p => normTxtDev(p).includes(selNorm) || selNorm.includes(normTxtDev(p)))
        || '';
    }
    const opts = [`<option value="">${escSisreg(todosLabels[setorNorm] || `Todos (${setorNorm})`)}</option>`]
      .concat(baseLista.map(p => `<option value="${escSisreg(p)}">${escSisreg(p)}</option>`));
    if (selecionado && !matched && !selNorm.startsWith('todos')) {
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

  async function preencherDevolucaoDaFichaAtual() {
    const d = _copilotoState.dados;
    trocarAbaCopilotoRegulacao('devolucoes', 'pendente');
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    set('dev-pac-nome', d.paciente_nome || _copilotoState.patientNomeFila || '');
    set('dev-protocolo', d.codigo_solicitacao || '');
    set('dev-procedimento', d.especialidade_ou_exame || '');
    set('dev-telefone', d.paciente_telefone || '');
    const endInfo = verificarEnderecoRecifeFront({
      municipio: d.paciente_municipio,
      uf: d.paciente_uf,
      cep: d.paciente_cep,
      endereco: d.paciente_endereco,
      bairro: d.paciente_bairro
    });
    const motEl = document.getElementById('dev-motivo');
    const parecerNorm = normTxtDev(d.parecer_regulador || '');
    const ehProblemaCadastro = endInfo.status === 'fora_recife' || !d.paciente_telefone || /enderec|municip|fora de recife|telefone|cns|cadastro/.test(parecerNorm);
    if (motEl) {
      if (endInfo.status === 'fora_recife' || /enderec|municip|fora de recife/.test(parecerNorm)) {
        motEl.value = 'Endereço de outra cidade (fora de Recife) / Cadastro';
      } else if (/telefone|cns|cadastro/.test(parecerNorm) || !d.paciente_telefone) {
        motEl.value = 'Telefone / CNS / dados cadastrais desatualizados';
      } else if (/justificativa|exame previo|evolucao|resultado|laudo|clinica/.test(parecerNorm)) {
        motEl.value = 'Falta justificativa clínica / exame prévio';
      } else if (/procedimento|faixa etaria|codigo|especialidade/.test(parecerNorm)) {
        motEl.value = 'Procedimento incorreto / faixa etária';
      } else {
        motEl.value = 'Erro de digitação / texto clínico / CID';
      }
    }
    const setorAuto = ehProblemaCadastro
      ? 'ACS'
      : inferirSetorPorMotivoEProfFront(motEl ? motEl.value : '', d.medico_solicitante || '');
    const setorEl = document.getElementById('dev-setor-destino');
    if (setorEl) setorEl.value = setorAuto;
    popularSelectProfissionaisDevolucao(setorAuto, d.medico_solicitante || '');
    const obsDevolucaoAuto = d.parecer_regulador
      ? `${d.data_devolucao_regulador ? `[Data: ${d.data_devolucao_regulador}] ` : ''}${d.parecer_regulador}`
      : (endInfo.status === 'fora_recife' ? (endInfo.alerta || '') : (d.alertas_digitacao?.join('; ') || ''));
    set('dev-obs', obsDevolucaoAuto);

    // Preencher detalhes estruturados da ficha
    const endFull = [d.paciente_endereco, d.paciente_bairro, d.paciente_municipio, d.paciente_uf, d.paciente_cep]
      .filter(Boolean).join(' · ');
    set('dev-det-cns', d.paciente_cns || '');
    set('dev-det-dn', d.paciente_dn || '');
    set('dev-det-endereco', endFull);
    set('dev-det-cid', d.cid10 || '');
    set('dev-det-just', d.observacao_solicitante || d.observacoes_revisada || d.observacoes_original || '');
    set('dev-det-motivo-central', d.parecer_regulador ? `${d.data_devolucao_regulador ? `Regulador (${d.data_devolucao_regulador}): ` : 'Regulador: '}${d.parecer_regulador}` : '');
    const detBox = document.getElementById('dev-detalhes-box');
    if (detBox && (d.paciente_cns || endFull || d.cid10 || d.observacoes_revisada || d.parecer_regulador)) {
      detBox.open = true;
    }

    // Puxar documento ativo da Prévia (imagem recomprimida leve ou PDF até 1,5MB)
    removerAnexoNovaDevolucao();
    const imgAtiva = _copilotoState.anexos?.[_copilotoState.anexoIdx]?.imagem_base64;
    if (imgAtiva) {
      try {
        const comp = await comprimirDataUrlDevolucao(imgAtiva);
        definirAnexoNovaDevolucao(comp, 'image', `ficha-${(d.paciente_nome || 'sisreg').slice(0, 24)}.jpg`);
      } catch (_) {}
    } else if (_copilotoState.pdfBase64) {
      if (_copilotoState.pdfBase64.length <= 2_100_000) {
        definirAnexoNovaDevolucao(_copilotoState.pdfBase64, 'pdf', _copilotoState.pdfNome || 'documento-sisreg.pdf');
      } else if (typeof showToast === 'function') {
        showToast('ℹ️ PDF da Prévia excede 1,5 MB; use Ctrl+V de um print da página se quiser anexar.', true);
      }
    }
    document.getElementById('dev-pac-nome')?.focus();
  }

  function calcularBytesBase64Aprox(b64) {
    if (!b64) return 0;
    const idx = String(b64).indexOf(',');
    const payload = idx >= 0 ? String(b64).slice(idx + 1) : String(b64);
    return Math.round((payload.replace(/\s+/g, '').length * 3) / 4);
  }

  function comprimirDataUrlDevolucao(dataUrl, maxDim = 1100, quality = 0.72) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onerror = () => resolve(dataUrl);
      img.onload = () => {
        let w = img.width || maxDim;
        let h = img.height || maxDim;
        if (w > maxDim || h > maxDim) {
          if (w > h) { h = Math.round(h * (maxDim / w)); w = maxDim; }
          else { w = Math.round(w * (maxDim / h)); h = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        let out = canvas.toDataURL('image/jpeg', quality);
        if (out.length > 2_000_000) {
          out = canvas.toDataURL('image/jpeg', 0.55);
        }
        resolve(out);
      };
      img.src = dataUrl;
    });
  }

  function comprimirArquivoImagemDevolucao(file) {
    return comprimirImagemViaObjectUrl(file, 1100, 0.72);
  }

  function lerPdfDevolucaoBase64(file) {
    return new Promise((resolve, reject) => {
      if (file.size > 1_500_000) {
        reject(new Error('PDF maior que 1,5 MB. Use um print/foto da página (Ctrl+V) para manter o banco leve.'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Falha ao ler PDF'));
      reader.onload = (ev) => resolve(ev.target.result);
      reader.readAsDataURL(file);
    });
  }

  function definirAnexoNovaDevolucao(base64, tipo, nome) {
    if (!base64) {
      removerAnexoNovaDevolucao();
      return;
    }
    if (String(base64).length > 2_100_000) {
      if (typeof showToast === 'function') showToast('Arquivo excede 1,5 MB. Tire print ou use imagem menor.', true);
      return;
    }
    _devNovoAnexo = {
      base64,
      tipo: tipo === 'pdf' ? 'pdf' : 'image',
      nome: nome || (tipo === 'pdf' ? 'documento.pdf' : 'ficha.jpg'),
      bytes: calcularBytesBase64Aprox(base64)
    };
    renderPreviewAnexoNovaDevolucao();
  }

  function removerAnexoNovaDevolucao() {
    _devNovoAnexo = { base64: null, tipo: null, nome: '', bytes: 0 };
    renderPreviewAnexoNovaDevolucao();
  }

  function renderPreviewAnexoNovaDevolucao() {
    const pill = document.getElementById('dev-anexo-preview-pill');
    if (!pill) return;
    if (!_devNovoAnexo.base64) {
      pill.style.display = 'none';
      pill.innerHTML = '';
      return;
    }
    const kb = Math.max(1, Math.round((_devNovoAnexo.bytes || 0) / 1024));
    const icon = _devNovoAnexo.tipo === 'pdf' ? '📄' : '🖼️';
    pill.style.display = 'inline-flex';
    pill.innerHTML = `${icon} ${escSisreg(_devNovoAnexo.nome)} (${kb} KB) <button type="button" onclick="removerAnexoNovaDevolucao()" style="border:none;background:transparent;color:#991b1b;font-weight:900;cursor:pointer;" title="Remover anexo">✕</button>`;
  }

  async function processarArquivosNovaDevolucao(files) {
    const f = files && files[0];
    if (!f) return;
    const ehPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
    try {
      const b64 = ehPdf ? await lerPdfDevolucaoBase64(f) : await comprimirArquivoImagemDevolucao(f);
      definirAnexoNovaDevolucao(b64, ehPdf ? 'pdf' : 'image', f.name || (ehPdf ? 'documento.pdf' : 'print-sisreg.jpg'));
      if (typeof showToast === 'function') showToast('📎 Documento anexado à devolução!');
    } catch (err) {
      if (typeof showToast === 'function') showToast(err?.message || 'Não foi possível anexar arquivo.', true);
    }
  }

  function parseDetalhesDevFront(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  function calcularStatusPrazoDevFront(prazoEm, status) {
    if (status === 'corrigida') {
      return { vencido: false, urgente: false, label: 'Corrigida', cor: '#166534', bg: '#dcfce7' };
    }
    if (!prazoEm) {
      return { vencido: false, urgente: false, label: '3d restantes', cor: '#0369a1', bg: '#e0f2fe' };
    }
    const dt = new Date(prazoEm);
    if (Number.isNaN(dt.getTime())) {
      return { vencido: false, urgente: false, label: '3d restantes', cor: '#0369a1', bg: '#e0f2fe' };
    }
    const diffMs = dt.getTime() - Date.now();
    if (diffMs <= 0) {
      return { vencido: true, urgente: true, label: 'Prazo vencido', cor: '#991b1b', bg: '#fee2e2' };
    }
    const horas = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60)));
    if (horas < 24) {
      return { vencido: false, urgente: true, label: `Vence em ${horas}h`, cor: '#92400e', bg: '#fef3c7' };
    }
    const dias = Math.ceil(horas / 24);
    return {
      vencido: false,
      urgente: dias <= 1,
      label: `${dias}d restante${dias > 1 ? 's' : ''}`,
      cor: dias <= 1 ? '#92400e' : '#0369a1',
      bg: dias <= 1 ? '#fef3c7' : '#e0f2fe'
    };
  }

  function badgePrazoDevHtml(item) {
    if (item.status === 'corrigida') return '';
    const p = calcularStatusPrazoDevFront(item.prazo_em, item.status);
    const prorr = Number(item.prorrogacoes || 0);
    const prorrTag = prorr > 0 ? ` (+${prorr * 3}d)` : '';
    return `<span class="sisreg-pill-mini" style="background:${p.bg};color:${p.cor};border:1px solid ${p.cor}44;">⏳ ${escSisreg(p.label + prorrTag)}</span>`;
  }

  function renderDetalhesResumoDevHtml(det) {
    if (!det) return '';
    const partes = [];
    if (det.cns) partes.push(`<b>CNS/CPF:</b> ${escSisreg(det.cns)}`);
    if (det.dn) partes.push(`<b>DN:</b> ${escSisreg(det.dn)}`);
    if (det.endereco) partes.push(`<b>End. Ficha:</b> ${escSisreg(det.endereco)}`);
    if (det.cid10) partes.push(`<b>CID-10:</b> ${escSisreg(det.cid10)}`);
    if (det.hipotese) partes.push(`<b>Hipótese:</b> ${escSisreg(det.hipotese)}`);
    const linhaDados = partes.length
      ? `<div style="font-size:11.5px;color:#334155;margin-top:4px;line-height:1.45;">${partes.join(' · ')}</div>`
      : '';
    const centralBox = det.motivo_central
      ? `<div style="font-size:11.5px;color:#991b1b;background:#fef2f2;border:1px solid #fecaca;padding:5px 8px;border-radius:6px;margin-top:4px;"><b>❌ Central SISREG:</b> ${escSisreg(det.motivo_central)}</div>`
      : '';
    const justBox = det.justificativa_original
      ? `<div style="font-size:11.5px;color:#1e293b;background:#f1f5f9;border:1px solid #cbd5e1;padding:5px 8px;border-radius:6px;margin-top:4px;"><b>📄 Condições Clínicas Originais:</b> ${escSisreg(det.justificativa_original)}</div>`
      : '';
    return `${linhaDados}${centralBox}${justBox}`;
  }

  function atualizarPillArmazenamentoDev() {
    const el = document.getElementById('dev-storage-pill');
    if (!el) return;
    const comAnexo = (_sisregDevolucoesTodas || []).filter(x => x.tem_anexo);
    const totalBytes = comAnexo.reduce((acc, x) => acc + Number(x.anexo_bytes || 0), 0);
    const kb = Math.round(totalBytes / 1024);
    const sizeLabel = kb >= 1024 ? `${(kb / 1024).toFixed(2)} MB` : `${kb} KB`;
    el.textContent = `📦 Anexos: ${comAnexo.length} (${sizeLabel})`;
  }

  async function limparAnexosVencidosSisreg() {
    try {
      const res = await fetch(`${getApiUrlBase()}/sisreg/devolucoes/limpar-anexos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      Object.keys(_cacheAnexosDev).forEach(k => delete _cacheAnexosDev[k]);
      if (typeof showToast === 'function') {
        showToast(d.removidos > 0
          ? `🧹 ${d.removidos} anexo(s) expirado(s)/corrigido(s) removido(s) do banco!`
          : '✅ Nenhum anexo vencido ou pendente de limpeza.');
      }
      await carregarDevolucoesSisreg();
    } catch (_) {
      if (typeof showToast === 'function') showToast('Erro ao limpar anexos.', true);
    }
  }

  async function adiarPrazoDevolucaoSisreg(id) {
    try {
      const res = await fetch(`${getApiUrlBase()}/sisreg/devolucoes/${id}/adiar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (typeof showToast === 'function') showToast(data.error || 'Não foi possível adiar o prazo.', true);
        return;
      }
      if (typeof showToast === 'function') showToast('⏳ Prazo prorrogado por mais 3 dias!');
      await carregarDevolucoesSisreg();
    } catch (_) {
      if (typeof showToast === 'function') showToast('Erro ao adiar prazo.', true);
    }
  }

  function aplicarFiltrosDevolucoesLista(todas, statusFlt, setorFlt, busca, profFlt = '') {
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
      if (profFlt && !pertenceAoProfissionalDevolucaoFront(item, setorFlt, profFlt)) return false;
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
    sincronizarModoAbaDevolucoes();
    _sisregDevolucoes = aplicarFiltrosDevolucoesLista(_sisregDevolucoesTodas, _sisregDevFiltro, _sisregDevSetorFiltro, _sisregDevBusca);
    renderDevolucoesSisreg();
  }

  function atualizarBadgesDevolucoesSetores() {
    const todas = _sisregDevolucoesTodas || [];
    const pendentesRegulacao = todas.filter(x => (x.status || 'pendente') === 'pendente').length;
    const respondidasRegulacao = todas.filter(x => x.status === 'respondida').length;

    const badge = document.getElementById('sisreg-dev-badge');
    const badgeBar = document.getElementById('sisreg-dev-badge-bar');
    [badge, badgeBar].forEach(el => {
      if (el) {
        el.style.display = pendentesRegulacao > 0 ? 'inline-flex' : 'none';
        el.textContent = String(pendentesRegulacao);
      }
    });

    const respBadge = document.getElementById('sisreg-resp-badge');
    const respBadgeBar = document.getElementById('sisreg-resp-badge-bar');
    [respBadge, respBadgeBar].forEach(el => {
      if (el) {
        el.style.display = respondidasRegulacao > 0 ? 'inline-flex' : 'none';
        el.textContent = String(respondidasRegulacao);
      }
    });

    const fltPend = document.getElementById('dev-flt-pend');
    if (fltPend) fltPend.textContent = `⏳ Pendentes (${pendentesRegulacao})`;
    const fltResp = document.getElementById('dev-flt-resp');
    if (fltResp) fltResp.textContent = `💬 Respondidas (${respondidasRegulacao})`;

    document.querySelectorAll('.sisreg-dev-badge-setor').forEach(el => {
      const setor = el.dataset.setor || '';
      const profAtivo = setor ? obterProfissionalAtivoTabSetorFront(setor) : '';
      const count = todas.filter(x => {
        if ((x.status || 'pendente') !== 'pendente') return false;
        return pertenceAoProfissionalDevolucaoFront(x, setor || 'todos', profAtivo);
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
    atualizarPillArmazenamentoDev();
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
      const detObj = parseDetalhesDevFront(item.detalhes_json);
      const temAnexo = Boolean(item.tem_anexo);
      const kbAnexo = temAnexo ? Math.max(1, Math.round(Number(item.anexo_bytes || 0) / 1024)) : 0;
      const podeAdiar = st !== 'corrigida' && Number(item.prorrogacoes || 0) < 3;

      return `
        <div class="sisreg-dev-card ${st === 'corrigida' ? 'ok' : (st === 'respondida' ? 'resp' : 'pend')}" style="${st === 'respondida' ? 'border-left-color:#2563eb;background:#f8fbff;' : ''}">
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <strong style="font-size:13.5px;color:#0f172a;">${escSisreg(item.paciente_nome)}</strong>
              ${item.codigo_solicitacao ? `<code class="sisreg-code-badge">${escSisreg(item.codigo_solicitacao)}</code>` : ''}
              ${badgeSetorDevolucaoHtml(setorDestino)}
              ${badgeDestinatarioDevHtml(item, setorDestino)}
              ${badgeStatusDevolucaoHtml(st)}
              ${badgePrazoDevHtml(item)}
              ${temAnexo ? `<span class="sisreg-pill-mini" style="background:#f3e8ff;color:#6b21a8;border:1px solid #d8b4fe;">📎 Anexo (${kbAnexo} KB)</span>` : ''}
              ${dataFmt ? `<span style="font-size:11px;color:#64748b;font-weight:700;">🕒 ${escSisreg(dataFmt)}</span>` : ''}
            </div>
            <div style="display:flex;gap:5px;flex-wrap:wrap;">
              ${(temAnexo || detObj)
                ? `<button type="button" class="btn btn-outline btn-sm" style="background:#faf5ff;color:#6b21a8;border-color:#d8b4fe;" onclick="abrirVisualizadorDevolucao(${item.id}, 'regulacao')">👁️ ${temAnexo ? 'Ver Documento' : 'Ver Detalhes'}</button>`
                : ''}
              ${podeAdiar
                ? `<button type="button" class="btn btn-outline btn-sm" onclick="adiarPrazoDevolucaoSisreg(${item.id})" title="Prorrogar prazo de resposta por mais 3 dias">⏳ +3d</button>`
                : ''}
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
          ${renderDetalhesResumoDevHtml(detObj)}
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
    const enviarChat = Boolean(document.getElementById('dev-enviar-chat')?.checked);
    if (!nome) {
      if (typeof showToast === 'function') showToast('Informe o nome do paciente devolvido.', true);
      return;
    }
    const detalhes = {
      cns: document.getElementById('dev-det-cns')?.value.trim() || null,
      dn: document.getElementById('dev-det-dn')?.value.trim() || null,
      endereco: document.getElementById('dev-det-endereco')?.value.trim() || null,
      cid10: document.getElementById('dev-det-cid')?.value.trim() || null,
      justificativa_original: document.getElementById('dev-det-just')?.value.trim() || null,
      motivo_central: document.getElementById('dev-det-motivo-central')?.value.trim() || null
    };
    const body = {
      paciente_nome: nome,
      codigo_solicitacao: document.getElementById('dev-protocolo')?.value.trim() || null,
      procedimento: document.getElementById('dev-procedimento')?.value.trim() || null,
      motivo,
      setor_destino: setorDestino,
      telefone: document.getElementById('dev-telefone')?.value.trim() || null,
      profissional_equipe: document.getElementById('dev-profissional')?.value.trim() || null,
      observacao: document.getElementById('dev-obs')?.value.trim() || null,
      detalhes,
      anexo_base64: _devNovoAnexo.base64 || null,
      anexo_tipo: _devNovoAnexo.tipo || null,
      anexo_nome: _devNovoAnexo.nome || null,
      enviar_chat: enviarChat
    };
    try {
      const res = await fetch(`${getApiUrlBase()}/sisreg/devolucoes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const created = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(created.error || 'Erro ao registrar devolução.');
      [
        'dev-pac-nome', 'dev-protocolo', 'dev-procedimento', 'dev-telefone', 'dev-obs',
        'dev-det-cns', 'dev-det-dn', 'dev-det-endereco', 'dev-det-cid', 'dev-det-just', 'dev-det-motivo-central'
      ].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      const profSel = document.getElementById('dev-profissional');
      if (profSel) profSel.value = '';
      const chkChat = document.getElementById('dev-enviar-chat');
      if (chkChat) chkChat.checked = false;
      removerAnexoNovaDevolucao();
      if (typeof showToast === 'function') {
        showToast(created.chat_notificado
          ? `✅ Devolução registrada (prazo 3 dias) e alerta enviado no canal ${setorDestino}!`
          : `✅ Devolução registrada (prazo 3 dias) na aba Devoluções para ${setorDestino}!`);
      }
      await carregarDevolucoesSisreg();
    } catch (err) {
      if (typeof showToast === 'function') showToast(err?.message || 'Erro ao registrar devolução.', true);
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
      if (status === 'corrigida') {
        delete _cacheAnexosDev[id];
      }
      await carregarDevolucoesSisreg();
      if (typeof showToast === 'function') {
        showToast(status === 'corrigida'
          ? '✅ Devolução marcada como corrigida e anexo apagado do banco!'
          : '↩️ Reaberta.');
      }
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
    const profDest = limparProfDevFront(item.profissional_equipe);
    const destLabel = profDest ? `🎯 Destinatário: ${profDest}` : `👥 Destinatário: Todos (${setorDestino})`;
    const texto = `↩️ DEVOLUÇÃO SISREG [Setor: ${setorDestino}${profDest ? ' · ' + profDest : ''}] — ${destLabel} | Paciente: ${item.paciente_nome}` +
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
      const det = parseDetalhesDevFront(item.detalhes_json);
      const prazoInfo = calcularStatusPrazoDevFront(item.prazo_em, item.status);
      const extraDet = [
        det?.cns ? `CNS/CPF: ${det.cns}` : '',
        det?.endereco ? `End: ${det.endereco}` : '',
        det?.motivo_central ? `Central: ${det.motivo_central}` : ''
      ].filter(Boolean).join(' | ');
      const pendTxt = [item.observacao, extraDet].filter(Boolean).join(' — ') || '—';
      const solTxt = item.solucao
        ? `${item.solucao}${item.solucao_autor ? ` [${item.solucao_autor}]` : ''}`
        : '—';
      return [
        idx + 1,
        `${formatarDataRecifeDev(item.created_at) || dataHoje}\n(${prazoInfo.label})`,
        item.paciente_nome || '—',
        item.codigo_solicitacao || '—',
        item.procedimento || '—',
        item.motivo || '—',
        direcionado,
        pendTxt,
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

  function revogarDevViewerPdfUrl() {
    if (_devVisualizadorState.pdfBlobUrl) {
      try { URL.revokeObjectURL(_devVisualizadorState.pdfBlobUrl); } catch (_) {}
      _devVisualizadorState.pdfBlobUrl = null;
    }
  }

  function criarBlobUrlPdfDev(b64) {
    try {
      const base = String(b64).includes(',') ? String(b64).split(',')[1] : String(b64);
      const bin = atob(base.replace(/\s+/g, ''));
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const blob = new Blob([arr], { type: 'application/pdf' });
      return URL.createObjectURL(blob);
    } catch (_) {
      return null;
    }
  }

  function abrirModalDevolucoesProfissional(setor = 'Médico', profInicial = null) {
    _devVisualizadorState.id = null;
    revogarDevViewerPdfUrl();
    const setorNorm = SETOR_DEV_META[setor] ? setor : 'todos';
    _devProfModalState.setor = setorNorm;
    if (profInicial !== null) {
      _devProfModalState.profissional = limparProfDevFront(profInicial);
    } else if (setorNorm !== 'todos') {
      _devProfModalState.profissional = limparProfDevFront(obterProfissionalAtivoTabSetorFront(setorNorm));
    } else {
      _devProfModalState.profissional = '';
    }
    _devProfModalState.status = 'pendente';
    const modal = document.getElementById('modal-devolucoes-profissional');
    if (!modal) return;
    renderModalDevolucoesProfissional();
    modal.classList.add('show');
    carregarDevolucoesSisreg();
  }

  function toggleComplementoDevProf(id, isViewer = false) {
    const boxId = isViewer ? `dev-viewer-edit-wrap-${id}` : `dev-prof-edit-wrap-${id}`;
    const box = document.getElementById(boxId);
    if (!box) return;
    const aberto = box.style.display !== 'none';
    box.style.display = aberto ? 'none' : 'block';
    if (!aberto) {
      const taId = isViewer ? `dev-viewer-sol-${id}` : `dev-prof-sol-${id}`;
      document.getElementById(taId)?.focus();
    }
  }

  function fecharModalDevolucoesProfissional() {
    _devVisualizadorState.id = null;
    revogarDevViewerPdfUrl();
    document.getElementById('modal-devolucoes-profissional')?.classList.remove('show');
  }

  function trocarSetorModalDevProf(setor) {
    _devVisualizadorState.id = null;
    revogarDevViewerPdfUrl();
    const setorNorm = setor || 'todos';
    _devProfModalState.setor = setorNorm;
    _devProfModalState.profissional = setorNorm !== 'todos'
      ? limparProfDevFront(obterProfissionalAtivoTabSetorFront(setorNorm))
      : '';
    renderModalDevolucoesProfissional();
  }

  function trocarProfissionalModalDevProf(prof) {
    _devVisualizadorState.id = null;
    revogarDevViewerPdfUrl();
    _devProfModalState.profissional = limparProfDevFront(prof);
    renderModalDevolucoesProfissional();
  }

  function trocarFiltroModalDevProf(flt) {
    _devVisualizadorState.id = null;
    revogarDevViewerPdfUrl();
    _devProfModalState.status = flt || 'abertas';
    renderModalDevolucoesProfissional();
  }

  function onBuscaModalDevProfInput(val) {
    _devProfModalState.busca = val || '';
    renderListaDevolucoesProfissional();
  }

  function aplicarAtalhoSolucaoDevProf(id, textoModelo, isViewer = false) {
    const elId = isViewer ? `dev-viewer-sol-${id}` : `dev-prof-sol-${id}`;
    const ta = document.getElementById(elId);
    if (!ta) return;
    ta.value = textoModelo;
    ta.focus();
    const len = ta.value.length;
    ta.setSelectionRange(len, len);
  }

  function aplicarTransformDevViewer() {
    const img = document.getElementById('dev-viewer-img');
    if (img) {
      img.style.transform = `translate(${_devVisualizadorState.panX}px, ${_devVisualizadorState.panY}px) scale(${_devVisualizadorState.zoom}) rotate(${_devVisualizadorState.rot}deg)`;
    }
  }
  function zoomDevViewerImg(d) {
    _devVisualizadorState.zoom = Math.max(0.5, Math.min(4.5, Number((_devVisualizadorState.zoom + d).toFixed(2))));
    aplicarTransformDevViewer();
  }
  function girarDevViewerImg() {
    _devVisualizadorState.rot = (_devVisualizadorState.rot + 90) % 360;
    aplicarTransformDevViewer();
  }
  function resetDevViewerImg() {
    _devVisualizadorState.zoom = 1;
    _devVisualizadorState.rot = 0;
    _devVisualizadorState.panX = 0;
    _devVisualizadorState.panY = 0;
    aplicarTransformDevViewer();
  }

  async function carregarAnexoDevolucaoLazy(id) {
    if (_cacheAnexosDev[id]) return _cacheAnexosDev[id];
    const res = await fetch(`${getApiUrlBase()}/sisreg/devolucoes/${id}/anexo`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Erro ao carregar documento.');
    const data = await res.json();
    _cacheAnexosDev[id] = data;
    return data;
  }

  function renderizarConteudoDocViewer(id, data) {
    const docArea = document.getElementById('dev-viewer-doc-area');
    if (!docArea || _devVisualizadorState.id !== id) return;
    if (!data || !data.tem_anexo || !data.anexo_base64) {
      docArea.innerHTML = `<div style="padding:26px;text-align:center;color:#fca5a5;font-weight:700;">⚠️ Documento já foi apagado do banco após expiração ou correção.</div>`;
      return;
    }
    if (data.anexo_tipo === 'pdf') {
      revogarDevViewerPdfUrl();
      const url = criarBlobUrlPdfDev(data.anexo_base64);
      _devVisualizadorState.pdfBlobUrl = url;
      docArea.innerHTML = `<iframe src="${url || data.anexo_base64}" style="width:100%;height:500px;border:none;border-radius:8px;background:#fff;" title="PDF Devolução SISREG"></iframe>`;
    } else {
      docArea.innerHTML = `<img id="dev-viewer-img" src="${data.anexo_base64}" alt="Documento da devolução" draggable="false" style="max-width:100%;max-height:100%;object-fit:contain;transform-origin:center center;transition:transform 0.1s ease;cursor:grab;">`;
      aplicarTransformDevViewer();
      if (typeof window.initPreviaPanZoom === 'function') {
        window.initPreviaPanZoom(
          'dev-viewer-doc-area',
          'dev-viewer-img',
          () => _devVisualizadorState,
          (patch) => { Object.assign(_devVisualizadorState, patch); },
          aplicarTransformDevViewer
        );
      }
    }
  }

  async function abrirVisualizadorDevolucao(id, origem = 'profissional') {
    const item = (_sisregDevolucoesTodas || []).find(x => x.id === id);
    if (!item) return;
    const setorItem = item.setor_destino || inferirSetorPorMotivoEProfFront(item.motivo, item.profissional_equipe);
    const modal = document.getElementById('modal-devolucoes-profissional');
    if (!modal) return;
    if (!modal.classList.contains('show')) {
      if (origem === 'regulacao') _devProfModalState.setor = 'todos';
      else if (SETOR_DEV_META[setorItem]) _devProfModalState.setor = setorItem;
      _devProfModalState.status = 'todas';
      modal.classList.add('show');
    }
    _devVisualizadorState = { id, zoom: 1, rot: 0, panX: 0, panY: 0, pdfBlobUrl: null };
    renderModalDevolucoesProfissional();

    const docArea = document.getElementById('dev-viewer-doc-area');
    if (!docArea) return;
    if (!item.tem_anexo) {
      docArea.innerHTML = `<div style="padding:26px;text-align:center;color:#94a3b8;font-weight:700;">📄 Nenhum documento visual anexado (ou já removido após expiração/correção).<br><span style="font-size:12px;">Confira todos os dados detalhados da ficha ao lado direito.</span></div>`;
      return;
    }

    if (_cacheAnexosDev[id]) {
      renderizarConteudoDocViewer(id, _cacheAnexosDev[id]);
      return;
    }

    docArea.innerHTML = `<div style="padding:26px;text-align:center;color:#cbd5e1;font-weight:800;">⏳ Carregando documento anexo...</div>`;
    try {
      const data = await carregarAnexoDevolucaoLazy(id);
      renderizarConteudoDocViewer(id, data);
    } catch (_) {
      if (_devVisualizadorState.id === id && docArea) {
        docArea.innerHTML = `<div style="padding:26px;text-align:center;color:#fca5a5;font-weight:700;">❌ Não foi possível carregar o documento anexo.</div>`;
      }
    }
  }

  function fecharVisualizadorDevolucao() {
    _devVisualizadorState.id = null;
    revogarDevViewerPdfUrl();
    renderModalDevolucoesProfissional();
  }

  function abrirBuscaSisregParaDevolucao(devId, setor = 'Médico', termoInicial = '') {
    _devolucaoAlvoBuscaId = devId;
    abrirModalSisregConsulta(setor || 'Médico', 'busca', termoInicial || '');
  }

  function obterListaFiltradaModalProf() {
    return aplicarFiltrosDevolucoesLista(
      _sisregDevolucoesTodas,
      _devProfModalState.status,
      _devProfModalState.setor,
      _devProfModalState.busca,
      _devProfModalState.profissional
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
    const autorInpExist = document.getElementById('dev-prof-autor-nome')?.value;
    const autorPadrao = (autorInpExist && autorInpExist.trim()) || detectarNomeProfissionalAtualFront(_devProfModalState.setor);
    const todas = _sisregDevolucoesTodas || [];
    const contarPendSetor = s => todas.filter(x => {
      if ((x.status || 'pendente') !== 'pendente') return false;
      const st = x.setor_destino || inferirSetorPorMotivoEProfFront(x.motivo, x.profissional_equipe);
      return s === 'todos' || st === s;
    }).length;

    const itemViewer = _devVisualizadorState.id
      ? todas.find(x => x.id === _devVisualizadorState.id)
      : null;
    if (_devVisualizadorState.id && !itemViewer) {
      _devVisualizadorState.id = null;
    }

    if (itemViewer) {
      const setorItem = itemViewer.setor_destino || inferirSetorPorMotivoEProfFront(itemViewer.motivo, itemViewer.profissional_equipe);
      const isAcs = setorItem === 'ACS';
      const detObj = parseDetalhesDevFront(itemViewer.detalhes_json);
      const podeAdiar = (itemViewer.status || 'pendente') !== 'corrigida' && Number(itemViewer.prorrogacoes || 0) < 3;
      const procTermoAttr = escSisreg(itemViewer.procedimento || '').replace(/'/g, '&#39;');
      const atalhosViewer = isAcs
        ? `
          <button type="button" class="motivo-chip" onclick="aplicarAtalhoSolucaoDevProf(${itemViewer.id}, 'Paciente mudou para o endereço: Rua , nº , Bairro , CEP .', true)">🏠 Mudou de endereço</button>
          <button type="button" class="motivo-chip" onclick="aplicarAtalhoSolucaoDevProf(${itemViewer.id}, 'Telefone atualizado do paciente: (81) 9', true)">📞 Novo telefone</button>
          <button type="button" class="motivo-chip" onclick="aplicarAtalhoSolucaoDevProf(${itemViewer.id}, 'Cadastro e residência confirmados em Recife na microárea.', true)">📍 Cadastro confirmado</button>
        `
        : `
          <button type="button" class="motivo-chip" onclick="aplicarAtalhoSolucaoDevProf(${itemViewer.id}, 'O procedimento correto no SISREG é: ', true)">🩺 Procedimento correto</button>
          <button type="button" class="motivo-chip" onclick="aplicarAtalhoSolucaoDevProf(${itemViewer.id}, 'Justificativa clínica complementar: ', true)">📝 Justificativa clínica</button>
          <button type="button" class="motivo-chip" onclick="aplicarAtalhoSolucaoDevProf(${itemViewer.id}, 'CID-10 correto:  | Solicitação readequada.', true)">🧬 Corrigir CID</button>
        `;
      modal.innerHTML = `
        <div class="previa-modal-card wide" style="max-width:1180px;">
          <div class="previa-modal-head" style="background:linear-gradient(135deg,#0f2c73,#9a3412);">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
              <button type="button" class="btn btn-sm" style="background:rgba(255,255,255,0.2);color:#fff;border:1px solid rgba(255,255,255,0.35);font-weight:800;" onclick="fecharVisualizadorDevolucao()">← Voltar para a Lista</button>
              <div>
                <div style="font-weight:900;font-size:15px;">👁️ Conferência do Documento — ${escSisreg(itemViewer.paciente_nome)}</div>
                <div style="font-size:11.5px;opacity:0.9;">Analise a ficha/print ao lado, confira o erro e envie a solução correta para a Regulação</div>
              </div>
            </div>
            <button type="button" class="previa-btn-close-red" onclick="fecharModalDevolucoesProfissional()">✕ Fechar</button>
          </div>
          <div class="previa-modal-body" style="background:#f8fafc;">
            <div class="sisreg-split-grid">
              <div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;align-items:center;">
                  <button type="button" class="btn btn-outline btn-sm" onclick="zoomDevViewerImg(-0.25)">➖ Zoom</button>
                  <button type="button" class="btn btn-outline btn-sm" onclick="zoomDevViewerImg(0.25)">➕ Zoom</button>
                  <button type="button" class="btn btn-outline btn-sm" onclick="girarDevViewerImg()">🔄 Girar</button>
                  <button type="button" class="btn btn-outline btn-sm" onclick="resetDevViewerImg()">🎯 Reset</button>
                  ${podeAdiar ? `<button type="button" class="btn btn-outline btn-sm" style="margin-left:auto;" onclick="adiarPrazoDevolucaoSisreg(${itemViewer.id})">⏳ Adiar +3d</button>` : ''}
                </div>
                <div id="dev-viewer-doc-area" class="sisreg-img-stage" style="height:500px;background:#0f172a;border-radius:12px;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;"></div>
              </div>
              <div style="display:flex;flex-direction:column;gap:8px;">
                <div class="sisreg-box">
                  <div class="sisreg-box-head" style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
                    <span>📋 Dados da Solicitação Devolvida</span>
                    <div style="display:flex;gap:4px;flex-wrap:wrap;">${badgeSetorDevolucaoHtml(setorItem)}${badgeStatusDevolucaoHtml(itemViewer.status || 'pendente')}${badgePrazoDevHtml(itemViewer)}</div>
                  </div>
                  <div style="font-size:12.5px;color:#0f172a;line-height:1.5;">
                    <div><b>Paciente:</b> ${escSisreg(itemViewer.paciente_nome)} ${itemViewer.codigo_solicitacao ? ` · <code class="sisreg-code-badge">${escSisreg(itemViewer.codigo_solicitacao)}</code>` : ''}</div>
                    <div><b>Motivo:</b> ${escSisreg(itemViewer.motivo)}</div>
                    ${itemViewer.procedimento ? `<div><b>Procedimento Pedido:</b> ${escSisreg(itemViewer.procedimento)}</div>` : ''}
                    ${itemViewer.telefone ? `<div><b>Telefone:</b> ${escSisreg(itemViewer.telefone)}</div>` : ''}
                    ${itemViewer.profissional_equipe ? `<div><b>Profissional/ACS:</b> ${escSisreg(itemViewer.profissional_equipe)}</div>` : ''}
                  </div>
                  ${itemViewer.observacao ? `<div style="font-size:12px;color:#7c2d12;margin-top:6px;background:#fff7ed;padding:7px 9px;border-radius:6px;border:1px solid #fed7aa;"><b>Orientação da Regulação:</b> ${escSisreg(itemViewer.observacao)}</div>` : ''}
                  ${renderDetalhesResumoDevHtml(detObj)}
                </div>

                <div class="sisreg-box">
                  <div class="sisreg-box-head" style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
                    <span>💬 Resposta / Solução Correta</span>
                    ${!isAcs && (itemViewer.status || 'pendente') !== 'corrigida' ? `<button type="button" class="btn btn-primary btn-sm" style="background:#0f2c73;border-color:#0f2c73;" onclick="abrirBuscaSisregParaDevolucao(${itemViewer.id}, '${setorItem}', '${procTermoAttr}')">🔎 Buscar Código SISREG</button>` : ''}
                  </div>
                  ${(itemViewer.status || 'pendente') === 'pendente'
                    ? `
                      <input type="text" id="dev-prof-autor-nome" value="${escSisreg(autorPadrao)}" placeholder="Seu nome (Profissional / ACS) *" style="width:100%;padding:7px 10px;border:1.5px solid #93c5fd;border-radius:8px;font-size:12.5px;font-weight:700;margin-bottom:6px;">
                      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:6px;">${atalhosViewer}</div>
                      <textarea id="dev-viewer-sol-${itemViewer.id}" rows="4" placeholder="${isAcs ? 'Ex: Paciente mudou para Rua X, nº Y, Bairro Z...' : 'Ex: O procedimento correto no SISREG é..., CID..., justificativa...'}" style="width:100%;padding:8px 10px;border:1.5px solid #2563eb;border-radius:8px;font-size:13px;font-weight:700;">${escSisreg(itemViewer.solucao || '')}</textarea>
                      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap;">
                        <label style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:800;color:#475569;cursor:pointer;">
                          <input type="checkbox" id="dev-viewer-chat-${itemViewer.id}"> 💬 Avisar também no Chat Interno (opcional)
                        </label>
                        <button type="button" class="btn btn-primary btn-sm" style="background:#0f766e;border-color:#0f766e;font-weight:800;padding:8px 14px;" onclick="salvarSolucaoModalProfissional(${itemViewer.id}, this, true)">💾 Enviar Solução para Regulação</button>
                      </div>
                    `
                    : `
                      <div style="font-size:12.5px;color:#065f46;background:#ecfdf5;border:1px solid #6ee7b7;border-radius:8px;padding:9px 11px;">
                        <div style="font-weight:900;margin-bottom:4px;">${itemViewer.status === 'corrigida' ? '✅ Devolução corrigida pela Regulação' : '✅ Resposta já enviada para a Regulação'}${itemViewer.solucao_autor ? ` (${escSisreg(itemViewer.solucao_autor)})` : ''}</div>
                        <div>${escSisreg(itemViewer.solucao || 'Sem texto registrado.')}</div>
                      </div>
                      ${itemViewer.status === 'respondida' ? `
                        <div style="margin-top:8px;">
                          <button type="button" class="btn btn-outline btn-sm" onclick="toggleComplementoDevProf(${itemViewer.id}, true)">✏️ Complementar / Alterar Resposta</button>
                          <div id="dev-viewer-edit-wrap-${itemViewer.id}" style="display:none;margin-top:8px;">
                            <input type="text" id="dev-prof-autor-nome" value="${escSisreg(autorPadrao)}" placeholder="Seu nome (Profissional / ACS) *" style="width:100%;padding:7px 10px;border:1.5px solid #93c5fd;border-radius:8px;font-size:12.5px;font-weight:700;margin-bottom:6px;">
                            <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:6px;">${atalhosViewer}</div>
                            <textarea id="dev-viewer-sol-${itemViewer.id}" rows="3" style="width:100%;padding:8px 10px;border:1.5px solid #2563eb;border-radius:8px;font-size:13px;font-weight:700;">${escSisreg(itemViewer.solucao || '')}</textarea>
                            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap;">
                              <label style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:800;color:#475569;cursor:pointer;">
                                <input type="checkbox" id="dev-viewer-chat-${itemViewer.id}"> 💬 Avisar também no Chat Interno (opcional)
                              </label>
                              <button type="button" class="btn btn-primary btn-sm" style="background:#0f766e;border-color:#0f766e;font-weight:800;" onclick="salvarSolucaoModalProfissional(${itemViewer.id}, this, true)">💾 Enviar Atualização</button>
                            </div>
                          </div>
                        </div>
                      ` : ''}
                    `}
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
      if (_cacheAnexosDev[itemViewer.id]) {
        renderizarConteudoDocViewer(itemViewer.id, _cacheAnexosDev[itemViewer.id]);
      } else if (!itemViewer.tem_anexo) {
        const docArea = document.getElementById('dev-viewer-doc-area');
        if (docArea) {
          docArea.innerHTML = `<div style="padding:26px;text-align:center;color:#94a3b8;font-weight:700;">📄 Nenhum documento visual anexado (ou já removido após expiração/correção).<br><span style="font-size:12px;">Confira todos os dados detalhados da ficha ao lado direito.</span></div>`;
        }
      }
      return;
    }

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

    const listaProfsFiltro = _devProfModalState.setor !== 'todos'
      ? (PROFISSIONAIS_DEVOLUCAO_POR_SETOR[_devProfModalState.setor] || [])
      : [];
    const contarPendProf = (pNome) => todas.filter(x => {
      if ((x.status || 'pendente') !== 'pendente') return false;
      return pertenceAoProfissionalDevolucaoFront(x, _devProfModalState.setor, pNome);
    }).length;
    const selectProfHtml = listaProfsFiltro.length > 0
      ? `<select id="dev-prof-filtro-prof" onchange="trocarProfissionalModalDevProf(this.value)" style="padding:6px 10px;border:1.5px solid #2563eb;border-radius:8px;font-size:12.5px;font-weight:800;background:#eff6ff;color:#1e3a8a;">
          <option value="">👥 Todos de ${escSisreg(_devProfModalState.setor)} (${contarPendSetor(_devProfModalState.setor)})</option>
          ${listaProfsFiltro.map(p => {
            const qtdP = contarPendProf(p);
            const sel = normTxtDev(_devProfModalState.profissional) === normTxtDev(p) ? ' selected' : '';
            return `<option value="${escSisreg(p)}"${sel}>🎯 ${escSisreg(p)}${qtdP > 0 ? ` (${qtdP})` : ''}</option>`;
          }).join('')}
        </select>`
      : '';

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
            ${selectProfHtml}
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
      const detObj = parseDetalhesDevFront(item.detalhes_json);
      const temAnexo = Boolean(item.tem_anexo);
      const kbAnexo = temAnexo ? Math.max(1, Math.round(Number(item.anexo_bytes || 0) / 1024)) : 0;
      const podeAdiar = (item.status || 'pendente') !== 'corrigida' && Number(item.prorrogacoes || 0) < 3;
      const procTermoAttr = escSisreg(item.procedimento || '').replace(/'/g, '&#39;');
      return `
        <div class="sisreg-dev-card ${item.status === 'corrigida' ? 'ok' : (item.status === 'respondida' ? 'resp' : 'pend')}">
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <strong style="font-size:14px;color:#0f172a;">${escSisreg(item.paciente_nome)}</strong>
              ${item.codigo_solicitacao ? `<code class="sisreg-code-badge">${escSisreg(item.codigo_solicitacao)}</code>` : ''}
              ${badgeSetorDevolucaoHtml(setorItem)}
              ${badgeDestinatarioDevHtml(item, setorItem)}
              ${badgeStatusDevolucaoHtml(item.status || 'pendente')}
              ${badgePrazoDevHtml(item)}
              ${temAnexo ? `<span class="sisreg-pill-mini" style="background:#f3e8ff;color:#6b21a8;border:1px solid #d8b4fe;">📎 Documento (${kbAnexo} KB)</span>` : ''}
              ${dataFmt ? `<span style="font-size:11px;color:#64748b;font-weight:700;">🕒 ${escSisreg(dataFmt)}</span>` : ''}
            </div>
            <div style="display:flex;gap:5px;flex-wrap:wrap;">
              <button type="button" class="btn btn-primary btn-sm" style="background:#6b21a8;border-color:#6b21a8;font-weight:800;" onclick="abrirVisualizadorDevolucao(${item.id}, 'profissional')">👁️ ${temAnexo ? 'Conferir Documento e Responder' : 'Conferência Detalhada'}</button>
              ${!isAcs ? `<button type="button" class="btn btn-outline btn-sm" onclick="abrirBuscaSisregParaDevolucao(${item.id}, '${setorItem}', '${procTermoAttr}')">🔎 Buscar SISREG</button>` : ''}
              ${podeAdiar ? `<button type="button" class="btn btn-outline btn-sm" onclick="adiarPrazoDevolucaoSisreg(${item.id})" title="Prorrogar prazo em +3 dias">⏳ +3d</button>` : ''}
            </div>
          </div>
          <div style="font-size:12px;color:#334155;margin-top:5px;">
            <b>Motivo:</b> ${escSisreg(item.motivo)}
            ${item.procedimento ? ` · <b>Proc.:</b> ${escSisreg(item.procedimento)}` : ''}
            ${item.telefone ? ` · <b>Tel.:</b> ${escSisreg(item.telefone)}` : ''}
            ${item.profissional_equipe ? ` · <b>Direcionado:</b> ${escSisreg(item.profissional_equipe)}` : ''}
          </div>
          ${item.observacao ? `<div style="font-size:12px;color:#7c2d12;margin-top:5px;background:#fff7ed;padding:6px 8px;border-radius:6px;border:1px solid #fed7aa;"><b>Solicitação da Regulação:</b> ${escSisreg(item.observacao)}</div>` : ''}
          ${renderDetalhesResumoDevHtml(detObj)}
          ${(item.status || 'pendente') === 'pendente'
            ? `
              <div style="margin-top:8px;">
                <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:5px;">
                  <span style="font-size:11px;font-weight:800;color:#475569;">Atalhos de resposta:</span>
                  ${atalhosHtml}
                </div>
                <textarea id="dev-prof-sol-${item.id}" rows="2" placeholder="${placeholder}" style="width:100%;padding:7px 9px;border:1.5px solid #93c5fd;border-radius:8px;font-size:12.5px;font-weight:700;color:#0f172a;">${escSisreg(item.solucao || '')}</textarea>
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap;">
                  <label style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:800;color:#475569;cursor:pointer;">
                    <input type="checkbox" id="dev-prof-chat-${item.id}"> 💬 Avisar também no Chat Interno (opcional)
                  </label>
                  <button type="button" class="btn btn-primary btn-sm" style="background:#0f766e;border-color:#0f766e;font-weight:800;" onclick="salvarSolucaoModalProfissional(${item.id}, this, false)">💾 Enviar Solução para Regulação</button>
                </div>
              </div>
            `
            : `
              <div style="margin-top:8px;font-size:12px;color:#065f46;background:#ecfdf5;border:1px solid #6ee7b7;border-radius:8px;padding:8px 10px;">
                <div style="font-weight:900;margin-bottom:3px;">${item.status === 'corrigida' ? '✅ Devolução corrigida pela Regulação' : '✅ Resposta já enviada para a Regulação'}${item.solucao_autor ? ` (${escSisreg(item.solucao_autor)})` : ''}</div>
                <div>${escSisreg(item.solucao || 'Sem texto registrado.')}</div>
                ${item.status === 'respondida' ? `
                  <div style="margin-top:6px;">
                    <button type="button" class="btn btn-outline btn-sm" style="font-size:11px;padding:3px 8px;" onclick="toggleComplementoDevProf(${item.id}, false)">✏️ Complementar resposta</button>
                    <div id="dev-prof-edit-wrap-${item.id}" style="display:none;margin-top:6px;">
                      <textarea id="dev-prof-sol-${item.id}" rows="2" placeholder="${placeholder}" style="width:100%;padding:7px 9px;border:1.5px solid #93c5fd;border-radius:8px;font-size:12.5px;font-weight:700;color:#0f172a;">${escSisreg(item.solucao || '')}</textarea>
                      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:5px;flex-wrap:wrap;">
                        <label style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:800;color:#475569;cursor:pointer;">
                          <input type="checkbox" id="dev-prof-chat-${item.id}"> 💬 Avisar também no Chat Interno (opcional)
                        </label>
                        <button type="button" class="btn btn-primary btn-sm" style="background:#0f766e;border-color:#0f766e;font-weight:800;" onclick="salvarSolucaoModalProfissional(${item.id}, this, false)">💾 Enviar Atualização</button>
                      </div>
                    </div>
                  </div>
                ` : ''}
              </div>
            `}
        </div>
      `;
    }).join('');
  }

  async function salvarSolucaoModalProfissional(id, btn, fromViewer = false) {
    if (_salvandoSolucaoDevId === id) return;
    const elId = fromViewer ? `dev-viewer-sol-${id}` : `dev-prof-sol-${id}`;
    const sol = document.getElementById(elId)?.value.trim()
      || document.getElementById(`dev-prof-sol-${id}`)?.value.trim()
      || '';
    if (!sol) {
      if (typeof showToast === 'function') showToast('Digite a solução ou comentário antes de enviar.', true);
      return;
    }
    const autorInp = document.getElementById('dev-prof-autor-nome')?.value.trim() || '';
    const autor = autorInp || _devProfModalState.setor || 'Profissional';
    const chatChkId = fromViewer ? `dev-viewer-chat-${id}` : `dev-prof-chat-${id}`;
    const notificarChat = Boolean(document.getElementById(chatChkId)?.checked);
    _salvandoSolucaoDevId = id;
    const textoOriginalBtn = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = '0.6';
      btn.textContent = '⏳ Enviando...';
    }
    try {
      const res = await fetch(`${getApiUrlBase()}/sisreg/devolucoes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ solucao: sol, solucao_autor: autor, notificar_chat: notificarChat })
      });
      if (!res.ok) throw new Error();
      const updated = await res.json().catch(() => ({}));
      fecharModalDevolucoesProfissional();
      if (typeof showToast === 'function') {
        showToast(updated.chat_notificado
          ? '✅ Solução enviada (aba Respondidas) e Regulação avisada no Chat Interno!'
          : '✅ Solução enviada! Já aparece no botão Respondidas da Regulação.');
      }
      await carregarDevolucoesSisreg();
    } catch (_) {
      if (typeof showToast === 'function') showToast('Erro ao enviar solução.', true);
      if (btn) {
        btn.disabled = false;
        btn.style.opacity = '';
        btn.textContent = textoOriginalBtn;
      }
    } finally {
      _salvandoSolucaoDevId = null;
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
    _devolucaoAlvoBuscaId = null;
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
      const btnLabel = _devolucaoAlvoBuscaId
        ? '✅ Usar na Solução'
        : (ehLab ? '🧪 Form. Exames' : (ehExame ? '📋 Exame na Ficha' : '📝 Usar na Ficha'));
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
    if (_devolucaoAlvoBuscaId) {
      const devId = _devolucaoAlvoBuscaId;
      _devolucaoAlvoBuscaId = null;
      const textoProc = proc.code ? `${proc.name} (${proc.code})` : proc.name;
      const prefix = `O procedimento correto no SISREG é: ${textoProc}. `;
      const taViewer = document.getElementById(`dev-viewer-sol-${devId}`);
      const taList = document.getElementById(`dev-prof-sol-${devId}`);
      const ta = taViewer || taList;
      if (ta) {
        const atual = ta.value.trim();
        ta.value = atual ? `${atual}\n${prefix}` : prefix;
        ta.focus();
      }
      fecharModalSisregMedico();
      if (typeof showToast === 'function') showToast('✅ Procedimento inserido na resposta da devolução!');
      return;
    }
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

  function atualizarBotaoCameraModalMed() {
    const btnCam = document.getElementById('sm-btn-cam');
    if (!btnCam) return;
    const qtd = (_modalMedState.anexos || []).length;
    btnCam.textContent = qtd > 0 ? `📸 + Tirar outra foto (${qtd}/6)` : '📸 Tirar Foto';
  }

  function renderVisualizadorModalMed() {
    const imgEl = document.getElementById('sm-stage-img');
    const pdfFrame = document.getElementById('sm-stage-pdf-iframe');
    const emptyEl = document.getElementById('sm-stage-empty');
    const navEl = document.getElementById('sm-img-nav');
    const cntEl = document.getElementById('sm-img-counter');
    const strip = document.getElementById('sm-thumbs-strip');
    const total = (_modalMedState.anexos || []).length;
    atualizarBotaoCameraModalMed();
    revogarMedPdfBlobUrl();

    if (total === 0) {
      _modalMedState.arquivoTipo = null;
      _modalMedState.imgBase64 = null;
      _modalMedState.pdfNome = '';
      if (imgEl) { imgEl.src = ''; imgEl.style.display = 'none'; }
      if (pdfFrame) { pdfFrame.src = 'about:blank'; pdfFrame.style.display = 'none'; }
      if (emptyEl) emptyEl.style.display = 'flex';
      if (navEl) navEl.style.display = 'none';
      if (strip) { strip.style.display = 'none'; strip.innerHTML = ''; }
      return;
    }

    if (_modalMedState.anexoIdx >= total) _modalMedState.anexoIdx = total - 1;
    if (_modalMedState.anexoIdx < 0) _modalMedState.anexoIdx = 0;
    const ativo = _modalMedState.anexos[_modalMedState.anexoIdx];
    const ehPdf = ativo.tipo === 'pdf' || isDataUrlPdfSisreg(ativo.imagem_base64, ativo.mime_type);
    _modalMedState.arquivoTipo = ehPdf ? 'pdf' : 'image';
    _modalMedState.imgBase64 = ehPdf ? null : ativo.imagem_base64;
    _modalMedState.pdfNome = ativo.nome_arquivo || '';

    if (emptyEl) emptyEl.style.display = 'none';
    if (ehPdf) {
      if (imgEl) { imgEl.src = ''; imgEl.style.display = 'none'; }
      if (pdfFrame) {
        const blobUrl = criarBlobUrlPdfSisreg(ativo.imagem_base64);
        _medPdfBlobUrl = blobUrl;
        pdfFrame.src = blobUrl || ativo.imagem_base64;
        pdfFrame.style.display = 'block';
      }
    } else {
      resetModalMedImgView();
      if (pdfFrame) { pdfFrame.src = 'about:blank'; pdfFrame.style.display = 'none'; }
      if (imgEl) { imgEl.src = ativo.imagem_base64; imgEl.style.display = 'block'; }
    }

    if (navEl) {
      navEl.style.display = total > 1 ? 'flex' : 'none';
      if (cntEl) cntEl.textContent = `Arquivo ${_modalMedState.anexoIdx + 1} de ${total}${ehPdf ? ' · 📄 PDF' : ''}`;
    }
    if (strip) {
      if (total > 1) {
        strip.style.display = 'flex';
        strip.innerHTML = _modalMedState.anexos.map((a, idx) => {
          const isP = a.tipo === 'pdf' || isDataUrlPdfSisreg(a.imagem_base64, a.mime_type);
          const thumbBody = isP
            ? `<div class="pr-thumb-pdf-mini">📄</div>`
            : `<img src="${a.imagem_base64}" alt="Arquivo ${idx + 1}">`;
          return `<button type="button" class="vp-thumb-btn${idx === _modalMedState.anexoIdx ? ' active' : ''}" onclick="selecionarFotoModalMed(${idx})">
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

  function navegarFotoModalMed(delta) {
    const t = (_modalMedState.anexos || []).length;
    if (t <= 1) return;
    _modalMedState.anexoIdx = (_modalMedState.anexoIdx + delta + t) % t;
    renderVisualizadorModalMed();
  }

  function selecionarFotoModalMed(idx) {
    if (idx < 0 || idx >= (_modalMedState.anexos || []).length) return;
    _modalMedState.anexoIdx = idx;
    renderVisualizadorModalMed();
  }

  function limparAnexosModalSisregMedico() {
    _modalMedState.anexos = [];
    _modalMedState.anexoIdx = 0;
    _modalMedState.dados = criarDadosVaziosSisreg();
    _modalMedState.sugestoes = [];
    renderVisualizadorModalMed();
    preencherCamposModalMedico();
    renderSugestoesModalMedico();
    const statusEl = document.getElementById('sm-ocr-status');
    if (statusEl) statusEl.style.display = 'none';
  }

  async function processarArquivoModalSisregMedico(fileList) {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;
    const statusEl = document.getElementById('sm-ocr-status');
    const vagas = 6 - (_modalMedState.anexos || []).length;
    if (vagas <= 0) {
      if (typeof showToast === 'function') showToast('Limite máximo de 6 arquivos atingido nesta leitura.', true);
      return;
    }

    const selecionados = files.slice(0, vagas);
    const novosItens = [];
    for (let i = 0; i < selecionados.length; i++) {
      const file = selecionados[i];
      const ehPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      const ehImg = !file.type || file.type.startsWith('image/');
      if (!ehPdf && !ehImg) continue;
      try {
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.className = 'pr-status-box loading';
          statusEl.textContent = ehPdf ? '⏳ Preparando PDF...' : '⏳ Preparando foto capturada...';
        }
        const b64 = ehPdf ? await lerPdfBase64(file) : await comprimirImagemSisreg(file);
        _modalMedState.anexos.push({
          id: `sm_${Date.now().toString(36)}_${i + 1}`,
          tipo: ehPdf ? 'pdf' : 'image',
          mime_type: ehPdf ? 'application/pdf' : 'image/jpeg',
          nome_arquivo: file.name || (ehPdf ? 'documento.pdf' : 'foto.jpg'),
          imagem_base64: b64
        });
        _modalMedState.anexoIdx = _modalMedState.anexos.length - 1;
        novosItens.push({ b64, acumular: _modalMedState.anexos.length > 1 });
        renderVisualizadorModalMed();
      } catch (err) {
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.className = 'pr-status-box warn';
          statusEl.textContent = `⚠️ ${err.message}`;
        }
      }
    }

    for (let i = 0; i < novosItens.length; i++) {
      const it = novosItens[i];
      await analisarItemModalSisregMedico(it.b64, it.acumular, i, novosItens.length);
    }
  }

  async function analisarItemModalSisregMedico(b64, acumular = false, idx = 0, total = 1) {
    const statusEl = document.getElementById('sm-ocr-status');
    try {
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.className = 'pr-status-box loading';
        statusEl.textContent = total > 1
          ? `⏳ Extraindo texto (${idx + 1} de ${total}) e conferindo no SISREG...`
          : '⏳ Extraindo texto da ficha e conferindo no SISREG...';
      }
      const { data } = await fetchJsonSisregComTimeout(`${getApiUrlBase()}/sisreg/analisar-ficha`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arquivo_base64: b64 })
      }, 42000);
      if (data.ok && data.dados) {
        _modalMedState.dados = mesclarDadosSisreg(_modalMedState.dados, data.dados, acumular);
        _modalMedState.sugestoes = Array.isArray(data.sugestoes_procedimentos) ? data.sugestoes_procedimentos : _modalMedState.sugestoes;
        incrementarContadorLidasHoje();
        const tagProv = formatarTagProvedorSisreg(data);
        if (statusEl && !renderBannerReceitaNoSisreg(statusEl, data.alerta_receita, tagProv)) {
          statusEl.className = 'pr-status-box ok';
          statusEl.textContent = `✅ Leitura concluída (${_modalMedState.anexos.length} arquivo${_modalMedState.anexos.length > 1 ? 's' : ''})! Copie o texto para o PEC ou transfira para a Ficha Ambulatorial. · ${tagProv}`;
        }
        preencherCamposModalMedico();
        renderSugestoesModalMedico();
      } else {
        exibirStatusErroOcrComRetry(
          statusEl,
          data.error || 'Não foi possível ler automaticamente.',
          'reanalisarAnexoAtivoModalMed'
        );
      }
    } catch (err) {
      exibirStatusErroOcrComRetry(
        statusEl,
        err?.message || 'Falha na leitura.',
        'reanalisarAnexoAtivoModalMed'
      );
    }
  }

  async function reanalisarAnexoAtivoModalMed() {
    const ativo = (_modalMedState.anexos || [])[_modalMedState.anexoIdx];
    const b64 = ativo?.imagem_base64 || _modalMedState.imgBase64;
    if (!b64) {
      if (typeof showToast === 'function') showToast('Anexe uma foto ou PDF primeiro.', true);
      return;
    }
    await analisarItemModalSisregMedico(b64, _modalMedState.anexoIdx > 0, 0, 1);
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

  // CTRL+V GLOBAL PARA MODAL REGULAÇÃO (LEITOR OU DEVOLUÇÕES) E MODAL MÉDICO
  document.addEventListener('paste', (e) => {
    const modalMed = document.getElementById('modal-sisreg-medico');
    const modalMedAberto = modalMed && modalMed.classList.contains('show') && _modalMedState.aba === 'leitor';
    const modalReg = document.getElementById('modal-previa-regulacao');
    const modalRegLeitor = modalReg && modalReg.classList.contains('show') && _sisregAbaAtiva === 'leitor';
    const modalRegDev = modalReg && modalReg.classList.contains('show') && _sisregAbaAtiva === 'devolucoes';
    const modalCaptura = document.getElementById('modal-captura-receita')?.classList.contains('show');
    if (modalCaptura || (!modalMedAberto && !modalRegLeitor && !modalRegDev)) return;

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
      else if (modalRegDev) processarArquivosNovaDevolucao(files);
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
  window.usarObsSolicitanteNoCampoSisreg = usarObsSolicitanteNoCampoSisreg;
  window.copiarParecerReguladorSisreg = copiarParecerReguladorSisreg;
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
  window.trocarProfissionalModalDevProf = trocarProfissionalModalDevProf;
  window.atualizarBadgesDevolucoesSetores = atualizarBadgesDevolucoesSetores;
  window.trocarFiltroModalDevProf = trocarFiltroModalDevProf;
  window.onBuscaModalDevProfInput = onBuscaModalDevProfInput;
  window.aplicarAtalhoSolucaoDevProf = aplicarAtalhoSolucaoDevProf;
  window.exportarDevolucoesProfissionalPDF = exportarDevolucoesProfissionalPDF;
  window.toggleComplementoDevProf = toggleComplementoDevProf;
  window.salvarSolucaoModalProfissional = salvarSolucaoModalProfissional;
  window.processarArquivosNovaDevolucao = processarArquivosNovaDevolucao;
  window.removerAnexoNovaDevolucao = removerAnexoNovaDevolucao;
  window.limparAnexosVencidosSisreg = limparAnexosVencidosSisreg;
  window.adiarPrazoDevolucaoSisreg = adiarPrazoDevolucaoSisreg;
  window.abrirVisualizadorDevolucao = abrirVisualizadorDevolucao;
  window.fecharVisualizadorDevolucao = fecharVisualizadorDevolucao;
  window.zoomDevViewerImg = zoomDevViewerImg;
  window.girarDevViewerImg = girarDevViewerImg;
  window.resetDevViewerImg = resetDevViewerImg;
  window.abrirBuscaSisregParaDevolucao = abrirBuscaSisregParaDevolucao;
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
  window.reanalisarAnexoAtivoModalMed = reanalisarAnexoAtivoModalMed;
  window.navegarFotoModalMed = navegarFotoModalMed;
  window.selecionarFotoModalMed = selecionarFotoModalMed;
  window.limparAnexosModalSisregMedico = limparAnexosModalSisregMedico;
  window.aplicarProcedimentoSisregExterno = aplicarProcedimentoSisregExterno;
  window.transferirLeituraModalMedParaFicha = transferirLeituraModalMedParaFicha;
  window.copiarTextoSisreg = copiarTextoSisreg;
})();
