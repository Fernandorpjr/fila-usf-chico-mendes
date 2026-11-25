// Catálogo único e compartilhado de Exames Laboratoriais e Tubos de Coleta
// Laboratório Municipal do Recife — Profº Oswaldo Gonçalves de Lima (USF Chico Mendes)
// Funciona tanto no navegador (window.USFExamesTubos) quanto no Node.js (module.exports).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.USFExamesTubos = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {
  function normExLab(str) {
    return String(str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Ordem exata dos grupos no receituário oficial do Laboratório Municipal do Recife
  const GRUPOS_TUBOS_RECIFE = [
    {
      id: 'cinza',
      nome: 'Tubo Cinza (Fluoreto / Glicose)',
      nomeCurto: 'Cinza',
      tampa: 'Tampa Cinza',
      subtitulo: 'Glicose (GLC) e Pós-Prandial (GPP)',
      corHex: '#64748b',
      corBorda: '#475569',
      corFundoSuave: '#f1f5f9',
      corTexto: '#ffffff',
      corTextoSuave: '#334155',
      tipo: 'tubo',
      regraQtd: 'glicose_dupla' // Se tiver GLC + GPP (Julião), exige 2 coletas/tubos cinza
    },
    {
      id: 'roxo_imuno',
      nome: 'Tubo Roxo Imuno (HbA1c)',
      nomeCurto: 'Roxo HbA1c',
      tampa: 'Tampa Roxa (Imuno)',
      subtitulo: 'Hemoglobina Glicada — tubo separado da hematologia',
      corHex: '#7c3aed',
      corBorda: '#6d28d9',
      corFundoSuave: '#f5f3ff',
      corTexto: '#ffffff',
      corTextoSuave: '#5b21b6',
      tipo: 'tubo'
    },
    {
      id: 'amarelo_imuno',
      nome: 'Tubo Amarelo — Imunoquímica',
      nomeCurto: 'Amarelo Imuno',
      tampa: 'Tampa Amarela (Gel Bioq./Horm.)',
      subtitulo: 'Colesterol, Creatinina, Ureia, TGO/TGP, TSH, Vit. D, PSA...',
      corHex: '#eab308',
      corBorda: '#ca8a04',
      corFundoSuave: '#fefce8',
      corTexto: '#1e293b',
      corTextoSuave: '#854d0e',
      tipo: 'tubo'
    },
    {
      id: 'amarelo_soro',
      nome: 'Tubo Amarelo — Sorologia',
      nomeCurto: 'Amarelo Soro',
      tampa: 'Tampa Amarela (Gel Sorologia)',
      subtitulo: 'VDRL, HIV, Hepatites, Dengue — tubo separado da Imunoquímica',
      corHex: '#d97706',
      corBorda: '#b45309',
      corFundoSuave: '#fffbeb',
      corTexto: '#ffffff',
      corTextoSuave: '#92400e',
      tipo: 'tubo'
    },
    {
      id: 'roxo_hemato',
      nome: '1º Tubo Roxo — Hematologia',
      nomeCurto: '1º Roxo Hemato',
      tampa: 'Tampa Roxa (EDTA Hemato)',
      subtitulo: 'Hemograma, Eletroforese Hb, G6PD',
      corHex: '#9333ea',
      corBorda: '#7e22ce',
      corFundoSuave: '#faf5ff',
      corTexto: '#ffffff',
      corTextoSuave: '#6b21a8',
      tipo: 'tubo'
    },
    {
      id: 'roxo_abo',
      nome: '2º Tubo Roxo — ABO/Coombs',
      nomeCurto: '2º Roxo ABO/Coombs',
      tampa: 'Tampa Roxa (2º Tubo Imuno-Hemato)',
      subtitulo: 'Tipagem ABO/Rh, Coombs Direto/Indireto — exige 2º tubo roxo',
      corHex: '#581c87',
      corBorda: '#3b0764',
      corFundoSuave: '#f3e8ff',
      corTexto: '#ffffff',
      corTextoSuave: '#581c87',
      tipo: 'tubo'
    },
    {
      id: 'preto_vsh',
      nome: 'Tubo Preto (VHS)',
      nomeCurto: 'Preto VHS',
      tampa: 'Tampa Preta (Citrato VHS)',
      subtitulo: 'Velocidade de Hemossedimentação (VSH)',
      corHex: '#1e293b',
      corBorda: '#0f172a',
      corFundoSuave: '#f8fafc',
      corTexto: '#ffffff',
      corTextoSuave: '#0f172a',
      tipo: 'tubo'
    },
    {
      id: 'azul_coag',
      nome: 'Tubo Azul — Coagulograma',
      nomeCurto: 'Azul Coag.',
      tampa: 'Tampa Azul (Citrato Julião)',
      subtitulo: 'TPAE / TAP, TTPA, TS/TC',
      corHex: '#2563eb',
      corBorda: '#1d4ed8',
      corFundoSuave: '#eff6ff',
      corTexto: '#ffffff',
      corTextoSuave: '#1e40af',
      tipo: 'tubo'
    },
    {
      id: 'urina',
      nome: 'Pote Coletor — Urina',
      nomeCurto: 'Pote Urina',
      tampa: 'Coletor Urina',
      subtitulo: 'Sumário de Urina (SM) / Urocultura (CUC)',
      corHex: '#0284c7',
      corBorda: '#0369a1',
      corFundoSuave: '#e0f2fe',
      corTexto: '#ffffff',
      corTextoSuave: '#075985',
      tipo: 'coletor'
    },
    {
      id: 'fezes',
      nome: 'Pote Coletor — Fezes',
      nomeCurto: 'Pote Fezes',
      tampa: 'Coletor Fezes',
      subtitulo: 'Parasitológico de Fezes (PF1/PF2/PF3)',
      corHex: '#92400e',
      corBorda: '#78350f',
      corFundoSuave: '#fef3c7',
      corTexto: '#ffffff',
      corTextoSuave: '#78350f',
      tipo: 'coletor'
    }
  ];

  const GRUPO_BY_ID = Object.fromEntries(GRUPOS_TUBOS_RECIFE.map(g => [g.id, g]));

  // Mesmo dicionário de public/formularios/receituario-exames-laboratoriais.html + grupo de tubo oficial
  const MAPA_EXAMES_LAB = [
    // TUBO CINZA (FLUORETO) + COLETA-JULIÃO (GPP)
    { match: /\bHEMOGLOBINA GLICOSILADA\b|\bHEMOGLOBINA GLICADA\b|\bHBA1C\b|\bHB\.?GLIC\.?\b|\bHBGL\b/, label: 'HB.GLIC.(HBGL)', grupo: 'roxo_imuno' },
    { match: /\bGLICOSE POS[\s-]?PRANDIAL\b|\bGLICEMIA POS[\s-]?PRANDIAL\b|\bGLICOSEPP\b|\b\(GPP\)\b/, label: 'GLICOSEPP(GPP)', grupo: 'cinza' },
    { match: /\bDOSAGEM DE GLICOSE\b|\bGLICEMIA DE JEJUM\b|\bGLICEMIA\b|\bGLICOSE\b|\b\(GLC\)\b/, label: 'GLICOSE(GLC)', grupo: 'cinza' },

    // TUBO AMARELO IMUNOQUÍMICA (42 exames do formulário)
    { match: /\bAC\.?\s*FOL\.?\b|\bACIDO FOLICO\b|\bFOLATO\b/, label: 'AC. FOL.(FOL)', grupo: 'amarelo_imuno' },
    { match: /\bAC\.?\s*URICO\b|\bACIDO URICO\b/, label: 'AC.URICO(AU)', grupo: 'amarelo_imuno' },
    { match: /\bALBUMINA\b/, label: 'ALBUMINA(ALB)', grupo: 'amarelo_imuno' },
    { match: /\bALFG\.?P\.?A\b|\bALFA[\s-]?1[\s-]?GLICOPROTEINA\b|\bA1GL\b/, label: 'ALFG.P.A.(A1GL)', grupo: 'amarelo_imuno' },
    { match: /\bAMILASE\b/, label: 'AMILASE(AMI)', grupo: 'amarelo_imuno' },
    { match: /\bANTIESTREPTOLISINA\b|\bASLO\b/, label: 'ASLO(AEO)', grupo: 'amarelo_imuno' },
    { match: /\bANTIPEROXIDASE\b|\bANTI[\s-]?TPO\b|\bATPO\b/, label: 'ATPO(ATP)', grupo: 'amarelo_imuno' },
    { match: /\bGONADOTROFINA CORIONICA\b|\bBHCG\b|\bBETA[\s-]?HCG\b/, label: '(BHCGQ)', grupo: 'amarelo_imuno' },
    { match: /\bBILIR\.?\b|\bBILIRRUBINA/, label: 'BILIR.T.+F(BIL)', grupo: 'amarelo_imuno' },
    { match: /\bCALCIO\b/, label: 'CALCIO(CA)', grupo: 'amarelo_imuno' },
    { match: /\bCREATINOFOSFOQUINASE\b|\bCK\b|\bCPK\b/, label: 'CK(CPK)', grupo: 'amarelo_imuno' },
    { match: /\bSODIO\b|\bPOTASSIO\b|\bCLORETO\b|\bCLORO\b|\bIONOGRAMA\b|\bCL,K,NA\b|\bIONO\b/, label: 'CL,K,NA(IONO)', grupo: 'amarelo_imuno' },
    { match: /\bCITOMEGALOVIRUS\b.*\bIGM\b|\bCMV\s*IGM\b|\bCMVM\b/, label: 'CMVIgM(CMVM)', grupo: 'amarelo_imuno' },
    { match: /\bCITOMEGALOVIRUS\b.*\bIGG\b|\bCMV\s*IGG\b|\bCMVG\b/, label: 'CMV IgG(CMVG)', grupo: 'amarelo_imuno' },
    { match: /\bCOL\.?\s*T\.?\+?FR\b|\bCOLESTEROL\b|\bLIPIDOGRAMA\b|\bPERFIL LIPIDICO\b|\bHDL\b|\bLDL\b/, label: 'COL.T.+FR (CTF)', grupo: 'amarelo_imuno' },
    { match: /\bCREAT\.?\b|\bCREATININA\b/, label: 'CREAT. (CN)', grupo: 'amarelo_imuno' },
    { match: /\bDESIDROGENASE LATICA\b|\bDHL\b|\bLDH\b/, label: 'DHL(DHL)', grupo: 'amarelo_imuno' },
    { match: /\bESTRAD(?:IOL)?\b|\bE2\b/, label: 'ESTRAD(E2)', grupo: 'amarelo_imuno' },
    { match: /\bF\.?\s*REUMT\b|\bFATOR REUMATOIDE\b|\bLATR\b/, label: 'F.REUMT.(LATR)', grupo: 'amarelo_imuno' },
    { match: /\bFERRIT\.?\b|\bFERRITINA\b/, label: 'FERRIT. (FERRI)', grupo: 'amarelo_imuno' },
    { match: /\bFERRO SERICO\b|\bDOSAGEM DE FERRO\b|\bFERRO\(FC\)\b|\bFERRO\b/, label: 'FERRO(FC)', grupo: 'amarelo_imuno' },
    { match: /\bFOSFORO\b/, label: 'FÓSFORO(FOS)', grupo: 'amarelo_imuno' },
    { match: /\bFOLICULO ESTIMULANTE\b|\bFSH\b/, label: '(FSH)', grupo: 'amarelo_imuno' },
    { match: /\bGAMA[\s-]?GLUTAMIL\b|\bGAMAGT\b|\bGGT\b/, label: 'GAMAGT(GGT)', grupo: 'amarelo_imuno' },
    { match: /\bINSULINA\b/, label: 'INSULINA(INS)', grupo: 'amarelo_imuno' },
    { match: /\bMAGNESIO\b/, label: 'MAGNÉSIO(MG)', grupo: 'amarelo_imuno' },
    { match: /\bPROTEINA C REATIVA\b|\bPCR\b/, label: '(PCR)', grupo: 'amarelo_imuno' },
    { match: /\bPROGEST(?:ERONA)?\b|\bPRG\b/, label: 'PROGEST(PRG)', grupo: 'amarelo_imuno' },
    { match: /\bPROLACT(?:INA)?\b|\bPRL\b/, label: 'PROLACT(PRL)', grupo: 'amarelo_imuno' },
    { match: /\bPROT\.?\s*T\s*\+\s*F\b|\bPROTEINAS TOTAIS\b|\bPTF\b/, label: 'PROT. T + F (PTF)', grupo: 'amarelo_imuno' },
    { match: /\bANTIGENO PROSTATICO\b|\bPSA\b/, label: 'PSA T + L (PSATL)', grupo: 'amarelo_imuno' },
    { match: /\bRUBEOLA\b|\bRUBEOLAG\b|\bRUBG\b/, label: 'RUBEOLAG(RUBG)', grupo: 'amarelo_imuno' },
    { match: /\bTRIIODOTIRONINA\b|\bT3\b/, label: '(T3)', grupo: 'amarelo_imuno' },
    { match: /\bTIROXINA LIVRE\b|\bT4\s*LIVRE\b|\bT4LIVRE\b|\bT4L\b/, label: 'T4LIVRE(T4L)', grupo: 'amarelo_imuno' },
    { match: /\bTESTOST(?:ERONA)?\b/, label: 'TESTOST(TES)', grupo: 'amarelo_imuno' },
    { match: /\bASPARTATO AMINO\b|\bTRANSAMINASE GLUTAMICO OXALACETICA\b|\bTGO\b|\bAST\b/, label: '(TGO)', grupo: 'amarelo_imuno' },
    { match: /\bALANINA AMINO\b|\bTRANSAMINASE GLUTAMICO PIRUVICA\b|\bTGP\b|\bALT\b/, label: '(TGP)', grupo: 'amarelo_imuno' },
    { match: /\bTIREOGLOBULINA\b/, label: 'TIREOGLOBULINA', grupo: 'amarelo_imuno' },
    { match: /\bTRIGLICERIDE/, label: 'TRIGLICERIDEOS', grupo: 'amarelo_imuno' },
    { match: /\bTOXO(?:PLASMOSE|PLASMA)?\b.*\bIGG\b|\bTOXG\b/, label: 'TOXO IgG(TOXG)', grupo: 'amarelo_imuno' },
    { match: /\bTOXO(?:PLASMOSE|PLASMA)?\b.*\bIGM\b|\bTOXM\b/, label: 'TOXO IgM(TOXM)', grupo: 'amarelo_imuno' },
    { match: /\bTIREOESTIMULANTE\b|\bTSH\b/, label: '(TSH)', grupo: 'amarelo_imuno' },
    { match: /\bUREIA\b/, label: 'UREIA(UREA)', grupo: 'amarelo_imuno' },
    { match: /\b25[\s-]?HIDROXIVITAMINA D\b|\bVITAMINA D\b|\bVIT\.?\s*D\b/, label: 'VITAMINA D', grupo: 'amarelo_imuno' },
    { match: /\bVITAMINA\s*\(?VB12\)?|\bVITAMINA B12\b|\bVIT\.?\s*B12\b|\bCIANOCOBALAMINA\b/, label: 'VITAMINA (VB12)', grupo: 'amarelo_imuno' },

    // TUBO AMARELO SOROLOGIA (14 exames do formulário — tubo separado da imunoquímica)
    { match: /\bVDRL\b|\bSIFILIS\b/, label: '(VDRL)', grupo: 'amarelo_soro' },
    { match: /\bHIV\b/, label: '(HIV)', grupo: 'amarelo_soro' },
    { match: /\bHTLV\b/, label: '(HTLV)', grupo: 'amarelo_soro' },
    { match: /\bHEPATITE A\b.*\bIGM\b|\bHAV\s*IGM\b|\bHAVM\b/, label: 'HAV IgM(HAVM)', grupo: 'amarelo_soro' },
    { match: /\bHEPATITE A\b.*\bIGG\b|\bHAV\s*IGG\b|\bHAVG\b/, label: 'HAV IgG(HAVG)', grupo: 'amarelo_soro' },
    { match: /\bHEPATITE C\b|\bANTI[\s-]?HCV\b|\bHCV\b/, label: '(HCV)', grupo: 'amarelo_soro' },
    { match: /\bHBSAG\b|\bANTIGENO DE SUPERFICIE.*HEPATITE B\b|\bHEPATITE B\b/, label: '(HBSAG)', grupo: 'amarelo_soro' },
    { match: /\bA-HBS\b|\bANTI[\s-]?HBS\b|\bAHBS\b/, label: 'A-HBS(AHBS)', grupo: 'amarelo_soro' },
    { match: /\bAHBC TOT\b|\bANTI[\s-]?HBC TOTAL\b|\bAHBCT\b/, label: 'AHBC TOT(AHBCT)', grupo: 'amarelo_soro' },
    { match: /\bAHBC\s*IGM\b|\bANTI[\s-]?HBC IGM\b|\bHBCM\b/, label: 'AHBCIgM(HBCM)', grupo: 'amarelo_soro' },
    { match: /\bA-HBE\b|\bANTI[\s-]?HBE\b|\bAHBE\b/, label: 'A-HBE(AHBE)', grupo: 'amarelo_soro' },
    { match: /\b\(HBE\)\b|\bHBEAG\b/, label: '(HBE)', grupo: 'amarelo_soro' },
    { match: /\bDENGUE\b|\bDENM\b/, label: 'DENGUE(DENM)', grupo: 'amarelo_soro' },
    { match: /\bTREPONEMA\b|\bFTA[\s-]?ABS\b|\bSIFTP\b/, label: 'TREPONEMA(SIFTP)', grupo: 'amarelo_soro' },

    // 1º TUBO ROXO (HEMATOLOGIA)
    { match: /\bHEMOGRAMA\b|\bHEMOG\.?\b|\bHGCOM\b/, label: 'HEMOG.(HGCOM)', grupo: 'roxo_hemato' },
    { match: /\bELETROFORESE DE HEMOGLOBINA\b|\bVAR\.HB\b|\bELETRO\b/, label: 'VAR.HB(ELETRO)', grupo: 'roxo_hemato' },
    { match: /\bG6PD\b|\bGLICOSE[\s-]?6[\s-]?FOSFATO\b/, label: 'G6PD', grupo: 'roxo_hemato' },

    // 2º TUBO ROXO (IMUNO-HEMATOLOGIA — tubo roxo separado)
    { match: /\bCOOMBS DIRETO\b/, label: 'COOMBS DIRETO', grupo: 'roxo_abo' },
    { match: /\bCOOMBS INDIRETO\b/, label: 'COOMBS INDIRETO', grupo: 'roxo_abo' },
    { match: /\bGRUPO ABO\b|\bFATOR RH\b|\bABO[\s\/-]*RH\b|\bTIPAGEM SANGUINEA\b|\bGSAFRH\b/, label: 'ABORH(GSAFRH)', grupo: 'roxo_abo' },

    // TUBO PRETO
    { match: /\bHEMOSSEDIMENTACAO\b|\bVHS\b|\bVSH\b/, label: 'VSH', grupo: 'preto_vsh' },

    // TUBO AZUL (COAGULOGRAMA - JULIÃO)
    { match: /\bATIVIDADE DA PROTROMBINA\b|\bTEMPO DE PROTROMBINA\b|\bTAP\b|\bTPAE\b/, label: 'TPAE', grupo: 'azul_coag' },
    { match: /\bTROMBOPLASTINA PARCIAL\b|\bTTPA\b/, label: 'TTPA', grupo: 'azul_coag' },
    { match: /\bTEMPO DE COAGULACAO\b|\bTEMPO DE SANGRAMENTO\b|\bCOAGULOGRAMA\b|\bTS\/TC\b/, label: 'TS/TC', grupo: 'azul_coag' },

    // COLETORES (URINA / FEZES)
    { match: /\bUROCULTURA\b|\bCULTURA DE BACTERIAS.*URINA\b|\bUROCUL\b|\b\(CUC\)\b/, label: 'UROCUL(CUC)', grupo: 'urina' },
    { match: /\bSUMARIO DE URINA\b|\bS\.?\s*URINA\b|\bELEMENTOS ANORMAIS\b|\bCARACTERES FISICOS.*URINA\b|\bEAS\b|\bURINA TIPO I\b/, label: 'S. URINA(SM)', grupo: 'urina' },
    { match: /\bFEZES 2\b|\bPF2\b/, label: 'FEZES 2(PF2)', grupo: 'fezes' },
    { match: /\bFEZES 3\b|\bPF3\b/, label: 'FEZES 3(PF3)', grupo: 'fezes' },
    { match: /\bPARASITOLOGICO\b|\bFEZES\b|\bEPF\b|\bPF1\b/, label: 'FEZES 1(PF1)', grupo: 'fezes' }
  ];

  // Perfis clínicos mais frequentes na USF Chico Mendes (1 clique na recepção/triagem)
  const PERFIS_RAPIDOS_COLETA = [
    {
      id: 'rotina',
      nome: 'Rotina / Check-up',
      icon: '⚡',
      exames: ['HEMOG.(HGCOM)', 'GLICOSE(GLC)', 'COL.T.+FR (CTF)', 'TRIGLICERIDEOS', 'CREAT. (CN)', 'UREIA(UREA)', '(TSH)', 'S. URINA(SM)']
    },
    {
      id: 'hiperdia',
      nome: 'Hiperdia (HAS/DM)',
      icon: '❤️',
      exames: ['GLICOSE(GLC)', 'HB.GLIC.(HBGL)', 'COL.T.+FR (CTF)', 'TRIGLICERIDEOS', 'CREAT. (CN)', 'UREIA(UREA)', 'CL,K,NA(IONO)', 'AC.URICO(AU)', 'S. URINA(SM)']
    },
    {
      id: 'pre_natal',
      nome: 'Pré-Natal',
      icon: '🤰',
      exames: ['HEMOG.(HGCOM)', 'ABORH(GSAFRH)', 'GLICOSE(GLC)', '(VDRL)', '(HIV)', '(HBSAG)', '(HCV)', 'TOXO IgG(TOXG)', 'TOXO IgM(TOXM)', 'S. URINA(SM)', 'UROCUL(CUC)']
    },
    {
      id: 'ist_sorologias',
      nome: 'IST / Sorologias',
      icon: '🛡️',
      exames: ['(VDRL)', '(HIV)', '(HBSAG)', '(HCV)', 'TREPONEMA(SIFTP)']
    }
  ];

  const LABEL_TO_GRUPO = Object.fromEntries(MAPA_EXAMES_LAB.map(item => [item.label, item.grupo]));

  function localizarExamePorTexto(txt) {
    const raw = String(txt || '').trim();
    if (!raw) return null;
    const norm = normExLab(raw);
    for (let i = 0; i < MAPA_EXAMES_LAB.length; i++) {
      const item = MAPA_EXAMES_LAB[i];
      if (normExLab(item.label) === norm || item.match.test(norm)) {
        return item;
      }
    }
    return null;
  }

  function extrairCodigosExamesDeTexto(entrada) {
    if (!entrada) return [];
    let itens = [];
    if (Array.isArray(entrada)) {
      itens = entrada.map(x => String(x || '').trim()).filter(Boolean);
    } else if (typeof entrada === 'string') {
      const s = entrada.trim();
      if (!s) return [];
      if (s.startsWith('[') || s.startsWith('{')) {
        try {
          const parsed = JSON.parse(s);
          if (Array.isArray(parsed)) return extrairCodigosExamesDeTexto(parsed);
          if (parsed && Array.isArray(parsed.exames)) return extrairCodigosExamesDeTexto(parsed.exames);
        } catch (_) {}
      }
      itens = s.split(/[,\n;|]+/).map(x => x.trim()).filter(Boolean);
    }

    const out = [];
    const seen = new Set();
    for (const pedaco of itens) {
      const hit = localizarExamePorTexto(pedaco);
      if (hit && !seen.has(hit.label)) {
        seen.add(hit.label);
        out.push(hit.label);
      }
    }
    return out;
  }

  function normalizarPayloadExamesColeta(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    let obj = raw;
    if (typeof raw === 'string') {
      const s = raw.trim();
      if (!s) return null;
      if (s.startsWith('{') || s.startsWith('[')) {
        try {
          obj = JSON.parse(s);
        } catch (_) {
          obj = extrairCodigosExamesDeTexto(s);
        }
      } else {
        obj = extrairCodigosExamesDeTexto(s);
      }
    }

    if (Array.isArray(obj)) {
      obj = { exames: obj };
    }
    if (!obj || typeof obj !== 'object') return null;

    const examesSet = new Set();
    if (Array.isArray(obj.exames)) {
      for (const item of obj.exames.slice(0, 60)) {
        const hit = localizarExamePorTexto(item);
        if (hit) examesSet.add(hit.label);
      }
    }

    const tubosManuaisMap = {};
    if (Array.isArray(obj.tubos_manuais)) {
      for (const tm of obj.tubos_manuais.slice(0, 15)) {
        if (typeof tm === 'string' && GRUPO_BY_ID[tm]) {
          tubosManuaisMap[tm] = Math.max(1, tubosManuaisMap[tm] || 1);
        } else if (tm && typeof tm === 'object' && GRUPO_BY_ID[tm.grupoId || tm.id]) {
          const gid = tm.grupoId || tm.id;
          const qtd = Math.max(0, Math.min(5, parseInt(tm.quantidade, 10) || 1));
          if (qtd > 0) tubosManuaisMap[gid] = qtd;
        }
      }
    } else if (obj.tubos_manuais && typeof obj.tubos_manuais === 'object') {
      Object.entries(obj.tubos_manuais).forEach(([gid, qtdRaw]) => {
        if (!GRUPO_BY_ID[gid]) return;
        const qtd = Math.max(0, Math.min(5, parseInt(qtdRaw, 10) || 0));
        if (qtd > 0) tubosManuaisMap[gid] = qtd;
      });
    }

    const perfis = Array.isArray(obj.perfis)
      ? obj.perfis.map(p => String(p || '').trim()).filter(p => PERFIS_RAPIDOS_COLETA.some(pr => pr.id === p))
      : [];

    const exames = Array.from(examesSet);
    const tubos_manuais = Object.entries(tubosManuaisMap).map(([grupoId, quantidade]) => ({ grupoId, quantidade }));
    const observacao = obj.observacao ? String(obj.observacao).trim().slice(0, 160) : '';

    if (exames.length === 0 && tubos_manuais.length === 0 && !observacao) {
      return null;
    }

    return {
      perfis,
      exames,
      tubos_manuais,
      ...(observacao ? { observacao } : {})
    };
  }

  function calcularResumoTubosColeta(rawPayload) {
    const payload = normalizarPayloadExamesColeta(rawPayload);
    if (!payload) {
      return {
        tubos: [],
        coletores: [],
        totalTubos: 0,
        exames: [],
        resumoCurto: ''
      };
    }

    const examesPorGrupo = {};
    for (const label of payload.exames) {
      const grupoId = LABEL_TO_GRUPO[label];
      if (!grupoId) continue;
      if (!examesPorGrupo[grupoId]) examesPorGrupo[grupoId] = [];
      examesPorGrupo[grupoId].push(label);
    }

    const manuaisMap = {};
    for (const tm of payload.tubos_manuais) {
      manuaisMap[tm.grupoId] = tm.quantidade;
    }

    const tubos = [];
    const coletores = [];

    for (const g of GRUPOS_TUBOS_RECIFE) {
      const exList = examesPorGrupo[g.id] || [];
      const manualQtd = manuaisMap[g.id] || 0;
      if (exList.length === 0 && manualQtd === 0) continue;

      let qtdCalculada = 0;
      if (exList.length > 0) {
        if (g.id === 'cinza') {
          const temGlc = exList.includes('GLICOSE(GLC)');
          const temGpp = exList.includes('GLICOSEPP(GPP)');
          qtdCalculada = (temGlc && temGpp) ? 2 : 1;
        } else {
          qtdCalculada = 1;
        }
      }

      const quantidade = Math.max(qtdCalculada, manualQtd);
      let detalhe = exList.join(', ');
      if (g.id === 'cinza' && quantidade >= 2 && exList.includes('GLICOSE(GLC)') && exList.includes('GLICOSEPP(GPP)')) {
        detalhe = 'Jejum (GLC) + Pós-prandial (GPP)';
      } else if (!detalhe && manualQtd > 0) {
        detalhe = g.subtitulo;
      }

      const entry = {
        grupoId: g.id,
        nome: g.nome,
        nomeCurto: g.nomeCurto,
        tampa: g.tampa,
        corHex: g.corHex,
        corBorda: g.corBorda,
        corFundoSuave: g.corFundoSuave,
        corTexto: g.corTexto,
        corTextoSuave: g.corTextoSuave,
        quantidade,
        exames: exList,
        detalhe
      };

      if (g.tipo === 'coletor') {
        coletores.push(entry);
      } else {
        tubos.push(entry);
      }
    }

    const totalTubos = tubos.reduce((acc, t) => acc + Number(t.quantidade || 0), 0);
    const partesResumo = tubos.map(t => `${t.quantidade}x ${t.nomeCurto}`);
    if (coletores.length > 0) {
      partesResumo.push(...coletores.map(c => `${c.quantidade}x ${c.nomeCurto}`));
    }

    return {
      tubos,
      coletores,
      totalTubos,
      exames: payload.exames,
      observacao: payload.observacao || '',
      resumoCurto: partesResumo.join(' · ')
    };
  }

  return {
    normExLab,
    GRUPOS_TUBOS_RECIFE,
    MAPA_EXAMES_LAB,
    PERFIS_RAPIDOS_COLETA,
    localizarExamePorTexto,
    extrairCodigosExamesDeTexto,
    normalizarPayloadExamesColeta,
    calcularResumoTubosColeta
  };
});
