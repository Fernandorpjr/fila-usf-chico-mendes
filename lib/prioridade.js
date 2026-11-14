// Regras de Prioridade (Lei nº 10.048/2000 — 1 a 10) e Horário Marcado
const SETORES_HORARIO_MARCADO = ['Médico', 'Odontologia', 'Enfermagem'];

function normalizarHorarioMarcado(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (m) {
    const hh = Math.min(23, Math.max(0, parseInt(m[1], 10)));
    const mm = m[2] ? Math.min(59, Math.max(0, parseInt(m[2], 10))) : 0;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  return s.slice(0, 5);
}

function calcularOrdemPrioridadeOdonto(idadeVal, prioridadeManual, tipoPrioridade, condicoesEspeciais) {
  let idadeNum = null;
  if (idadeVal !== undefined && idadeVal !== null && String(idadeVal).trim() !== '') {
    const parsed = Number(idadeVal);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 120) {
      idadeNum = parsed;
    }
  }

  const tipoNorm = String(tipoPrioridade || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const condNorm = String(condicoesEspeciais || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  const matches = [];

  if ((idadeNum !== null && idadeNum >= 80) || tipoNorm.includes('80') || tipoNorm.startsWith('1.')) {
    matches.push({ ordem: 1, label: '1. Idoso 80+ (Prioridade Especial)', nivel: 1 });
  }
  if (tipoNorm.startsWith('2.') || tipoNorm.includes('deficiencia') || tipoNorm.includes('pcd') || tipoNorm.includes('cadeirante') || condNorm.includes('pcd') || condNorm.includes('deficiencia')) {
    matches.push({ ordem: 2, label: '2. Pessoa com Deficiência (PCD)', nivel: 2 });
  }
  if (tipoNorm.startsWith('3.') || tipoNorm.includes('tea') || tipoNorm.includes('autismo') || condNorm.includes('tea') || condNorm.includes('autismo')) {
    matches.push({ ordem: 3, label: '3. Pessoa com TEA', nivel: 2 });
  }
  if (tipoNorm.startsWith('4.') || tipoNorm.includes('gestante') || condNorm.includes('gestante')) {
    matches.push({ ordem: 4, label: '4. Gestante', nivel: 2 });
  }
  if (tipoNorm.startsWith('5.') || tipoNorm.includes('lactante') || condNorm.includes('lactante')) {
    matches.push({ ordem: 5, label: '5. Lactante', nivel: 2 });
  }
  if (tipoNorm.startsWith('6.') || tipoNorm.includes('colo') || condNorm.includes('crianca_colo') || prioridadeManual === 'crianca_colo' || (idadeNum !== null && idadeNum >= 0 && idadeNum < 2)) {
    matches.push({ ordem: 6, label: '6. Criança de Colo (< 2 anos)', nivel: 2 });
  }
  if (tipoNorm.startsWith('7.') || tipoNorm.includes('mobilidade')) {
    matches.push({ ordem: 7, label: '7. Mobilidade Reduzida', nivel: 2 });
  }
  if (tipoNorm.startsWith('8.') || tipoNorm.includes('obesidade') || tipoNorm.includes('obeso')) {
    matches.push({ ordem: 8, label: '8. Obesidade', nivel: 2 });
  }
  if (tipoNorm.startsWith('9.') || (idadeNum !== null && idadeNum >= 60 && idadeNum < 80) || tipoNorm.includes('60') || (tipoNorm.includes('idoso') && !tipoNorm.includes('80'))) {
    matches.push({ ordem: 9, label: '9. Idoso 60+', nivel: 2 });
  }
  if (tipoNorm.startsWith('10.') || tipoNorm.includes('doador') || tipoNorm.includes('sangue')) {
    matches.push({ ordem: 10, label: '10. Doador de Sangue', nivel: 2 });
  }

  if (matches.length > 0) {
    matches.sort((a, b) => a.ordem - b.ordem);
    const best = matches[0];
    return {
      ordem_prioridade_odonto: best.ordem,
      prioridade: 'prioritario',
      tipo_prioridade: best.label,
      nivel: best.nivel
    };
  }

  if (prioridadeManual === 'prioritario') {
    return {
      ordem_prioridade_odonto: 9,
      prioridade: 'prioritario',
      tipo_prioridade: tipoPrioridade ? String(tipoPrioridade).trim() : '9. Idoso 60+',
      nivel: 2
    };
  }

  return {
    ordem_prioridade_odonto: 99,
    prioridade: 'geral',
    tipo_prioridade: null,
    nivel: 3
  };
}

function sortQueueRows(rawRows, setor) {
  const usaHorarioMarcado = SETORES_HORARIO_MARCADO.includes(setor);
  const rows = rawRows.map(r => {
    let rank = Number(r.ordem_prioridade_odonto);
    if (!Number.isInteger(rank) || rank < 1 || rank > 99) {
      const calc = calcularOrdemPrioridadeOdonto(r.idade, r.prioridade, r.tipo_prioridade, r.condicoes_especiais);
      rank = calc.ordem_prioridade_odonto;
    }
    const hm = normalizarHorarioMarcado(r.horario_marcado) || '99:99';
    const createdMs = r.created_at ? new Date(r.created_at).getTime() : 0;
    return { ...r, rank, hm, createdMs };
  });

  rows.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (usaHorarioMarcado && a.hm !== b.hm) return a.hm.localeCompare(b.hm);
    if (a.createdMs !== b.createdMs) return a.createdMs - b.createdMs;
    return (a.id || 0) - (b.id || 0);
  });

  return rows;
}

module.exports = {
  SETORES_HORARIO_MARCADO,
  normalizarHorarioMarcado,
  calcularOrdemPrioridadeOdonto,
  sortQueueRows
};
