// API Base URL
const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : '/api';

// ====== SECTOR CONFIG ======
const SETORES = ['Acolhimento', 'Farmácia', 'Regulação', 'Médico', 'Enfermagem', 'Odontologia'];

const SECTOR_CONFIG = {
  'Acolhimento': { icon: '💜', color: 'var(--purple)', colorDark: 'var(--purple-dark)', btnClass: 'btn-purple', tagClass: 'tag-acolhimento', key: 'acolhimento' },
  'Farmácia': { icon: '💊', color: 'var(--green)', colorDark: 'var(--green-dark)', btnClass: 'btn-green', tagClass: 'tag-farmacia', key: 'farmacia' },
  'Regulação': { icon: '📋', color: 'var(--blue)', colorDark: 'var(--blue-dark)', btnClass: 'btn-primary', tagClass: 'tag-regulacao', key: 'regulacao' },
  'Médico': { icon: '🩺', color: 'var(--orange)', colorDark: 'var(--orange-dark)', btnClass: 'btn-orange', tagClass: 'tag-medico', key: 'medico',
    profissionais: ['Dra. Anahy Duarte', 'Dr. Joene Halan', 'Dra. Mirela Mota'], defaultConsultorios: ['1','2','3'] },
  'Enfermagem': { icon: '👩‍⚕️', color: 'var(--teal)', colorDark: 'var(--teal-dark)', btnClass: 'btn-teal', tagClass: 'tag-enfermagem', key: 'enfermagem',
    profissionais: ['Mariana Vaz', 'Jorge Marcio', 'Lucelia de Abreu'], defaultConsultorios: ['4','5','6'] },
  'Odontologia': { icon: '🦷', color: 'var(--pink)', colorDark: 'var(--pink-dark)', btnClass: 'btn-pink', tagClass: 'tag-odontologia', key: 'odontologia',
    profissionais: ['Dra. Gisele Monteiro'], defaultConsultorios: ['Odontológico'] }
};

// ====== STATE ======
let queues = {}; SETORES.forEach(s => queues[s] = []);
let currentCalling = {}; SETORES.forEach(s => currentCalling[s] = null);
let callHistory = [], attendedPatients = [], totalAtendidos = 0, totalDesistencias = 0;
let lastSpokenCallId = null, chatMessages = [], unreadChatCount = 0;
let isAdmin = false, alertedPatients = new Set();

const CAPACITY_LIMITS = { 'Total': 30, 'Regulação': 10, 'Farmácia': 999, 'Médico': 999, 'Acolhimento': 999, 'Enfermagem': 999, 'Odontologia': 999 };

// ====== INIT: Generate sector screens ======
function initSectorScreens() {
  SETORES.forEach(setor => {
    const cfg = SECTOR_CONFIG[setor];
    const screenEl = document.getElementById('screen-' + cfg.key);
    if (!screenEl) return;

    let profHTML = '';
    if (cfg.profissionais) {
      const consultOpts = ['1','2','3','4','5','6','Odontológico'].map(c => `<option value="${c}" ${cfg.defaultConsultorios.includes(c)?'':''}>${c === 'Odontológico' ? 'Cons. Odontológico' : 'Consultório ' + c}</option>`).join('');
      const profOpts = cfg.profissionais.map(p => `<option value="${p}">${p}</option>`).join('');
      profHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
          <div class="form-group"><label>Consultório</label><select id="consultorio-${cfg.key}" style="width:100%;padding:12px;border-radius:8px;border:2px solid var(--gray-200);font-family:'Nunito Sans',sans-serif;font-weight:700;">${consultOpts}</select></div>
          <div class="form-group"><label>Profissional</label><select id="profissional-${cfg.key}" style="width:100%;padding:12px;border-radius:8px;border:2px solid var(--gray-200);font-family:'Nunito Sans',sans-serif;font-weight:700;">${profOpts}</select></div>
        </div>`;
    }

    screenEl.innerHTML = `
      <div class="sector-page-header">
        <div class="sector-icon-big" style="background:${cfg.color}22;">${cfg.icon}</div>
        <div><div class="sector-page-title">${setor}</div><div class="sector-page-sub">Chamada de pacientes para ${setor.toLowerCase()}</div></div>
      </div>
      <div class="calling-banner" id="banner-${cfg.key}">
        <div class="cb-icon">🔔</div>
        <div class="cb-text"><div class="cb-label">Chamando agora</div><div class="cb-name" id="banner-name-${cfg.key}">—</div><div class="cb-sector">${cfg.icon} ${setor}</div></div>
        <button class="btn btn-ghost btn-sm" onclick="speakAgain('${setor}')">🔊 Repetir</button>
      </div>
      <div class="card-white">
        ${profHTML}
        <div class="btn-group" style="margin-bottom:20px;">
          <button class="btn ${cfg.btnClass}" onclick="callNext('${setor}')" style="flex:1;">📢 Chamar Próximo</button>
          <button class="btn btn-orange" onclick="speakAgain('${setor}')" style="width:auto;padding:16px 20px;background:${cfg.color}33;color:${cfg.color};box-shadow:none;border:1px solid ${cfg.color}55;">🔊 Repetir</button>
        </div>
        <div class="sector-header">
          <div class="sector-name"><div class="sector-dot" style="background:${cfg.color}"></div>Aguardando</div>
          <span class="sector-count" style="background:${cfg.color};" id="cnt2-${cfg.key}">0</span>
        </div>
        <div class="queue-list" id="queue-${cfg.key}"></div>
      </div>`;
  });
}

function initOverview() {
  const container = document.getElementById('overview-container');
  if (!container) return;
  container.innerHTML = SETORES.map(setor => {
    const cfg = SECTOR_CONFIG[setor];
    return `<div class="card-white" id="overview-${cfg.key}">
      <div class="sector-header">
        <div class="sector-name"><div class="sector-dot" style="background:${cfg.color}"></div>${cfg.icon} ${setor}</div>
        <span class="sector-count" style="background:${cfg.color};" id="cnt-${cfg.key}">0 na fila</span>
      </div>
      <div class="queue-list" id="mini-queue-${cfg.key}"></div>
    </div>`;
  }).join('');
}

// ====== CLOCK ======
function updateClock() {
  const now = new Date();
  document.getElementById('clockDisplay').textContent = now.toLocaleTimeString('pt-BR');
  const date = now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  document.getElementById('dateDisplay').textContent = date.charAt(0).toUpperCase() + date.slice(1);
}
setInterval(updateClock, 1000); updateClock();

// ====== ADMIN ======
function toggleAdmin() {
  if (isAdmin) { isAdmin = false; updateAdminUI(); return; }
  const senha = prompt('🔒 Digite a senha administrativa:');
  if (!senha) return;
  fetch(`${API_URL}/verify-admin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha }) })
    .then(r => { if (r.ok) { isAdmin = true; showToast('🔓 Modo administrador ativado!'); } else { showToast('❌ Senha incorreta!', true); } updateAdminUI(); })
    .catch(() => showToast('Erro de conexão', true));
}

function updateAdminUI() {
  const btn = document.getElementById('btn-admin');
  if (isAdmin) { btn.textContent = '🔓 Admin'; btn.classList.add('unlocked'); document.body.classList.add('admin-active'); }
  else { btn.textContent = '🔒 Modo Público'; btn.classList.remove('unlocked'); document.body.classList.remove('admin-active'); }
}

// ====== SCREEN NAV ======
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
  if (name === 'chat') { unreadChatCount = 0; updateChatBadge(); setTimeout(() => { const c = document.getElementById('chat-messages'); if (c) c.scrollTop = c.scrollHeight; }, 50); }
}

// ====== FORM HELPERS ======
function togglePrioridadeDetalhes() {
  document.getElementById('prioridade-detalhes').style.display = document.getElementById('input-prioridade').value === 'prioritario' ? 'flex' : 'none';
}

function toggleTipoAtendimento() {
  const setor = document.getElementById('input-setor').value;
  document.getElementById('tipo-atendimento-grupo').style.display = ['Médico','Enfermagem','Odontologia'].includes(setor) ? 'flex' : 'none';
}

// ====== ADD PATIENT ======
async function addPatient(btn) {
  const nome = document.getElementById('input-nome').value.trim();
  const setor = document.getElementById('input-setor').value;
  const prioridade = document.getElementById('input-prioridade').value;
  const tipo_prioridade = prioridade === 'prioritario' ? document.getElementById('input-tipo-prioridade').value : null;
  const tipo_atendimento = ['Médico','Enfermagem','Odontologia'].includes(setor) ? document.getElementById('input-tipo-atendimento').value : null;

  if (!nome) { showToast('Digite o nome do paciente!', true); return; }
  if (!setor) { showToast('Selecione o setor!', true); return; }
  if (btn) btn.disabled = true;
  try {
    const r = await fetch(`${API_URL}/patients`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome, setor, prioridade, tipo_prioridade, tipo_atendimento }) });
    if (!r.ok) throw new Error();
    document.getElementById('input-nome').value = '';
    document.getElementById('input-setor').value = '';
    document.getElementById('input-prioridade').value = 'geral';
    togglePrioridadeDetalhes(); toggleTipoAtendimento();
    const prioLabel = prioridade === 'prioritario' ? ' ⭐ PRIORITÁRIO' : '';
    showToast(`${nome} adicionado à fila de ${setor}!${prioLabel}`);
    await loadQueues();
  } catch { showToast('Erro ao adicionar paciente!', true); }
  finally { if (btn) btn.disabled = false; }
}

// ====== CALL NEXT ======
async function callNext(setor) {
  try {
    const cfg = SECTOR_CONFIG[setor];
    let consultorio = null, profissional = null, medico = null;
    if (cfg.profissionais) {
      const cEl = document.getElementById('consultorio-' + cfg.key);
      const pEl = document.getElementById('profissional-' + cfg.key);
      consultorio = cEl ? cEl.value : null;
      profissional = pEl ? pEl.value : null;
      const consLabel = consultorio === 'Odontológico' ? 'Cons. Odontológico' : 'Consultório ' + consultorio;
      medico = `${consLabel} - ${profissional}`;
    }
    const r = await fetch(`${API_URL}/call-next/${setor}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ medico, consultorio, profissional }) });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
    loadQueues(); loadCurrentCalling();
  } catch (e) { showToast(e.message || `Fila de ${setor} está vazia!`, true); }
}

// ====== REMOVE PATIENT ======
async function removePatient(id, nome) {
  const senha = prompt(`🚶 Remover "${nome}" por desistência?\n\nDigite a senha administrativa:`);
  if (!senha) return;
  try {
    const r = await fetch(`${API_URL}/remove-patient`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, senha }) });
    if (r.status === 403) { showToast('❌ Senha incorreta!', true); return; }
    if (!r.ok) throw new Error();
    showToast(`🚶 ${nome} removido (desistência)`);
    loadQueues();
  } catch { showToast('Erro ao remover paciente!', true); }
}

// ====== SPEAK ======
let audioUnlocked = false;
function unlockAudio() {
  if (!audioUnlocked && 'speechSynthesis' in window) { const d = new SpeechSynthesisUtterance(' '); d.volume = 0; window.speechSynthesis.speak(d); audioUnlocked = true; }
  const g = document.getElementById('global-audio'); if (g) g.play().catch(() => {});
  document.getElementById('sound-modal').style.display = 'none';
  showToast('🔊 Som ativado com sucesso!');
}

function speak(nome, setor, audioUrl, medico) { speakViaSynthesis(nome, setor, medico); }

function speakAgain(setor) {
  if (currentCalling[setor]) { const p = currentCalling[setor]; speakViaSynthesis(p.nome, setor, p.medico); } else showToast('Nenhum paciente sendo chamado!', true);
}

function speakViaSynthesis(nome, setor, medico) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const h = new Date().getHours();
  const saudacao = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const destino = medico ? `ao ${medico}` : `à ${setor}`;
  const texto = `${saudacao}. Usuário ${nome}, dirija-se ${destino}.`;
  const utter = new SpeechSynthesisUtterance(texto);
  utter.lang = 'pt-BR'; utter.rate = 0.95; utter.pitch = 1;
  const voices = window.speechSynthesis.getVoices();
  const pv = voices.find(v => v.name.includes('Francisca') || v.name.includes('Antonio') || v.name.includes('Google português do Brasil') || v.name.includes('Luciana') || v.name.includes('Daniel'));
  const fv = voices.find(v => v.lang.startsWith('pt'));
  if (pv) utter.voice = pv; else if (fv) utter.voice = fv;
  window.speechSynthesis.speak(utter);
}

function speakPatientName() {
  if (!callHistory || !callHistory.length) { showToast('Nenhuma chamada registrada!', true); return; }
  const l = callHistory[0]; speakViaSynthesis(l.nome, l.setor, l.medico); showToast(`🔊 Chamando: ${l.nome}`);
}

function repeatLastCall() {
  if (callHistory && callHistory.length) { const l = callHistory[0]; speakViaSynthesis(l.nome, l.setor, l.medico); showToast(`🔊 Repetindo: ${l.nome}`); }
  else showToast('Nenhuma chamada no histórico!', true);
}

// ====== LOAD DATA ======
async function loadQueues() { try { const r = await fetch(`${API_URL}/queues`); queues = await r.json(); SETORES.forEach(s => { if (!queues[s]) queues[s] = []; }); updateAll(); } catch (e) { console.error(e); } }
async function loadCurrentCalling() { try { const r = await fetch(`${API_URL}/current-calling`); const d = await r.json(); currentCalling = d.current; totalAtendidos = d.totalAtendidos || 0; totalDesistencias = d.totalDesistencias || 0; updateBanners(); updatePainel(); updateStats(); } catch (e) { console.error(e); } }
async function loadHistory() { try { const r = await fetch(`${API_URL}/history`); callHistory = await r.json(); if (callHistory && callHistory.length) { const topId = callHistory[0].id; if (lastSpokenCallId !== null && topId !== lastSpokenCallId) { const p = callHistory[0]; speakViaSynthesis(p.nome, p.setor, p.medico); } lastSpokenCallId = topId; } updatePainel(); } catch (e) { console.error(e); } }
async function loadAttended() { try { const r = await fetch(`${API_URL}/attended`); attendedPatients = await r.json(); renderAttended(); } catch (e) { console.error(e); } }

// ====== UPDATE UI ======
function updateAll() { updateStats(); updateBadges(); updateQueues(); updateMiniQueues(); updateRecent(); }

function updateStats() {
  let total = 0;
  SETORES.forEach(s => { total += (queues[s] || []).filter(p => p.status === 'aguardando').length; });
  document.getElementById('stat-total').textContent = total;
  const ea = document.getElementById('stat-atendidos'); if (ea) ea.textContent = totalAtendidos;
  const ed = document.getElementById('stat-desist'); if (ed) ed.textContent = totalDesistencias;
  const tc = document.getElementById('stat-card-total');
  if (tc) { if (total >= CAPACITY_LIMITS['Total']) tc.classList.add('capacity-alert'); else tc.classList.remove('capacity-alert'); }
}

function updateBadges() {
  SETORES.forEach(setor => {
    const cfg = SECTOR_CONFIG[setor]; const count = (queues[setor] || []).filter(p => p.status === 'aguardando').length;
    const badge = document.getElementById('badge-' + cfg.key); if (badge) badge.textContent = count;
    const cnt = document.getElementById('cnt-' + cfg.key); if (cnt) cnt.textContent = count + ' na fila';
    const cnt2 = document.getElementById('cnt2-' + cfg.key); if (cnt2) cnt2.textContent = count;
  });
}

function getColor(setor) { return SECTOR_CONFIG[setor]?.color || 'var(--blue)'; }

function renderQueueItems(containerId, setor) {
  const el = document.getElementById(containerId); if (!el) return;
  const items = (queues[setor] || []).filter(p => p.status !== 'atendido' && p.status !== 'desistencia');
  if (!items.length) { el.innerHTML = '<div class="empty-state"><div class="es-icon">✅</div><p>Fila vazia</p></div>'; return; }
  el.innerHTML = items.map((p, i) => {
    const prioBadge = p.prioridade === 'prioritario' ? `<span class="priority-badge">⭐ ${p.tipo_prioridade || 'PRIORITÁRIO'}</span>` : '';
    const tipoLabel = p.tipo_atendimento ? `<span style="font-size:11px;color:var(--gray-600);margin-left:4px;">(${p.tipo_atendimento})</span>` : '';
    const removeBtn = `<button class="btn-danger admin-only" onclick="event.stopPropagation();removePatient(${p.id},'${p.nome.replace(/'/g,"\\'")}')">🚶</button>`;
    return `<div class="queue-item ${p.status==='chamado'?'calling':''}">
      <div class="queue-position" style="background:${p.status==='chamado'?'#b8860b':getColor(setor)}">${i+1}</div>
      <div class="queue-name">${p.nome}${prioBadge}${tipoLabel}</div>
      <div class="queue-time">${p.horario}</div>
      <span class="queue-status ${p.status==='chamado'?'status-calling':'status-waiting'}">${p.status==='chamado'?'📢 Chamando':'Aguardando'}</span>
      ${removeBtn}
    </div>`;
  }).join('');
}

function updateQueues() { SETORES.forEach(s => renderQueueItems('queue-' + SECTOR_CONFIG[s].key, s)); }
function updateMiniQueues() { SETORES.forEach(s => renderQueueItems('mini-queue-' + SECTOR_CONFIG[s].key, s)); }

function updateRecent() {
  const el = document.getElementById('recent-list');
  const all = []; SETORES.forEach(s => all.push(...(queues[s] || [])));
  if (!all.length) { el.innerHTML = '<div class="empty-state" style="padding:16px;"><div class="es-icon">🗒️</div><p>Nenhum cadastro ainda</p></div>'; return; }
  const sorted = all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
  el.innerHTML = sorted.map(p => {
    const cfg = SECTOR_CONFIG[p.setor] || {}; const prioBadge = p.prioridade === 'prioritario' ? ' ⭐' : '';
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--gray-100);border-radius:8px;border:1px solid var(--gray-200);">
      <div style="font-size:18px;">${cfg.icon||'📋'}</div>
      <div style="flex:1;"><div style="font-weight:700;font-size:14px;color:var(--gray-700);">${p.nome}${prioBadge}</div><div style="font-size:12px;color:var(--gray-600);">${p.setor} · ${p.horario}</div></div>
    </div>`;
  }).join('');
}

function updateBanners() {
  SETORES.forEach(setor => {
    const cfg = SECTOR_CONFIG[setor];
    const banner = document.getElementById('banner-' + cfg.key);
    const nameEl = document.getElementById('banner-name-' + cfg.key);
    if (banner && nameEl) {
      if (currentCalling[setor]) { banner.classList.add('visible'); nameEl.textContent = currentCalling[setor].nome; }
      else banner.classList.remove('visible');
    }
  });
}

function updatePainel() {
  const main = document.getElementById('painel-main');
  if (callHistory && callHistory.length) {
    const l = callHistory[0]; const cfg = SECTOR_CONFIG[l.setor] || {};
    const prioBadge = l.prioridade === 'prioritario' ? `<div class="priority-badge-tv">⭐ ${l.tipo_prioridade || 'PRIORITÁRIO'}</div>` : '';
    let details = '';
    if (l.consultorio) details += `<div style="font-size:18px;opacity:0.9;margin-top:6px;font-weight:700;">🏠 ${l.consultorio === 'Odontológico' ? 'Cons. Odontológico' : 'Consultório ' + l.consultorio}</div>`;
    if (l.profissional) details += `<div style="font-size:16px;opacity:0.85;margin-top:4px;font-weight:600;">👨‍⚕️ ${l.profissional}</div>`;
    else if (l.medico) details += `<div style="font-size:16px;opacity:0.85;margin-top:4px;font-weight:600;">👨‍⚕️ ${l.medico}</div>`;
    main.innerHTML = `<div class="painel-call-label">🔔 Chamando agora</div><div class="painel-call-name">${l.nome}</div><div class="painel-call-sector">${cfg.icon||'📋'} ${l.setor}${details}</div>${prioBadge}`;
  } else { main.innerHTML = '<div class="painel-empty">⏳ Aguardando chamadas...</div>'; }

  const histEl = document.getElementById('painel-history');
  if (!callHistory || !callHistory.length) { histEl.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:rgba(255,255,255,0.3);padding:24px;">Nenhuma chamada registrada</div>'; return; }
  histEl.innerHTML = callHistory.map((p, i) => {
    const cfg = SECTOR_CONFIG[p.setor] || {};
    const prioBadge = p.prioridade === 'prioritario' ? ' <span style="color:#ff8f00;font-weight:800;">⭐</span>' : '';
    const profDisplay = p.profissional ? ` · <b>${p.profissional}</b>` : p.medico ? ` · <b>${p.medico}</b>` : '';
    const consDisplay = p.consultorio ? ` · Cons. ${p.consultorio}` : '';
    return `<div class="painel-history-item" style="justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:16px;">
        <div class="ph-number">${i+1}</div>
        <div class="ph-info"><div class="ph-name">${p.nome}${prioBadge}</div><div class="ph-sector">${cfg.icon||''} ${p.setor}${profDisplay}${consDisplay}</div></div>
      </div>
      <div style="display:flex;align-items:center;gap:12px;">
        <div class="ph-time">${p.horario_chamada}</div>
        <button class="btn btn-ghost" onclick="speakViaSynthesis('${p.nome.replace(/'/g,"\\'")}','${p.setor}','${(p.medico||'').replace(/'/g,"\\'")}')" style="padding:6px 12px;font-size:13px;">🔊</button>
      </div>
    </div>`;
  }).join('');
}

// ====== ATTENDED ======
function renderAttended() {
  const el = document.getElementById('attended-list'); if (!el) return;
  const ce = document.getElementById('attended-count'); if (ce) ce.textContent = attendedPatients.length;
  const cb = document.getElementById('attended-count-big'); if (cb) cb.textContent = attendedPatients.length;
  if (!attendedPatients.length) { el.innerHTML = '<div class="empty-state"><div class="es-icon">✅</div><p>Nenhum paciente atendido ainda</p></div>'; return; }
  el.innerHTML = attendedPatients.map((p, i) => {
    const cfg = SECTOR_CONFIG[p.setor] || {};
    const prioBadge = p.prioridade === 'prioritario' ? `<span class="priority-badge">⭐</span>` : '';
    const prof = p.profissional || p.medico || '';
    const profLabel = prof ? `<span style="font-size:11px;color:var(--gray-600);"> · ${prof}</span>` : '';
    return `<div class="queue-item" style="border-left:4px solid var(--green);">
      <div class="queue-position" style="background:var(--green);">${attendedPatients.length - i}</div>
      <div class="queue-name">${p.nome}${prioBadge}${profLabel}</div>
      <span class="sector-tag ${cfg.tagClass||''}">${cfg.icon||''} ${p.setor}</span>
      <div class="queue-time">${p.horario_chamada || p.horario}</div>
      <span class="queue-status status-done">✅ Atendido</span>
    </div>`;
  }).join('');
}

async function applyFilters() {
  const data = document.getElementById('filter-data').value;
  const setor = document.getElementById('filter-setor').value;
  const prof = document.getElementById('filter-profissional').value;
  if (!data && !setor && !prof) { loadAttended(); return; }
  try {
    const params = new URLSearchParams(); if (data) params.set('data', data); if (setor) params.set('setor', setor); if (prof) params.set('profissional', prof);
    const r = await fetch(`${API_URL}/history/filtered?${params}`);
    attendedPatients = await r.json(); renderAttended();
  } catch { showToast('Erro ao filtrar', true); }
}

// ====== CHAT ======
async function loadChat() { try { const r = await fetch(`${API_URL}/chat`); chatMessages = await r.json(); renderChat(); } catch (e) { console.error(e); } }

function renderChat() {
  const c = document.getElementById('chat-messages'); if (!c) return;
  const meu = document.getElementById('chat-remetente').value;
  if (!chatMessages.length) { c.innerHTML = '<div class="empty-state" style="margin:auto;"><div class="es-icon">💬</div><p>Diga algo para os outros setores!</p></div>'; return; }
  c.innerHTML = chatMessages.map(m => {
    const t = new Date(m.created_at).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'});
    const isMe = m.remetente === meu || m.remetente.includes(meu);
    return `<div class="chat-bubble ${isMe?'bubble-sent':'bubble-received'}"><div class="chat-meta"><span>${m.remetente}</span></div><div>${m.mensagem}</div><div class="chat-time">${t}</div></div>`;
  }).join('');
  c.scrollTop = c.scrollHeight;
}

async function sendChatMessage() {
  const rem = document.getElementById('chat-remetente').value;
  const inp = document.getElementById('chat-input'); const msg = inp.value.trim();
  if (!msg) return;
  try { inp.disabled = true; const r = await fetch(`${API_URL}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ remetente: rem, mensagem: msg }) }); if (r.ok) inp.value = ''; }
  catch { showToast('Erro ao enviar mensagem!', true); }
  finally { inp.disabled = false; inp.focus(); }
}

function updateChatBadge() {
  const b = document.getElementById('badge-chat');
  if (b) { if (unreadChatCount > 0) { b.textContent = unreadChatCount; b.style.display = 'inline-block'; } else { b.style.display = 'none'; } }
}

// ====== INACTIVITY CHECK ======
function checkInactivity() {
  const now = new Date();
  SETORES.forEach(setor => {
    (queues[setor] || []).forEach(p => {
      if (p.status !== 'aguardando' || alertedPatients.has(p.id)) return;
      const diff = (now - new Date(p.created_at)) / 60000;
      if (diff >= 20) {
        alertedPatients.add(p.id);
        fetch(`${API_URL}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ remetente: '🤖 Sistema', mensagem: `⚠️ ALERTA: ${p.nome} aguarda há ${Math.round(diff)} minutos na fila de ${setor}` })
        }).catch(() => {});
      }
    });
  });
}
setInterval(checkInactivity, 60000);

// ====== PDF ======
function generatePDF() {
  if (!attendedPatients.length) { showToast('Não há pacientes para exportar.', true); return; }
  if (!window.jspdf || !window.jspdf.jsPDF) { showToast('Carregando biblioteca PDF...', true); return; }
  const { jsPDF } = window.jspdf; const doc = new jsPDF();
  doc.setFont('helvetica','bold'); doc.setFontSize(18); doc.text('Relatório de Atendimentos', 105, 20, { align: 'center' });
  doc.setFontSize(12); doc.setFont('helvetica','normal'); doc.text(`USF Chico Mendes | Data: ${new Date().toLocaleDateString('pt-BR')}`, 105, 28, { align: 'center' });
  const data = attendedPatients.map((p, i) => [attendedPatients.length - i, p.nome, p.prioridade === 'prioritario' ? '⭐ ' + (p.tipo_prioridade||'PRIO') : 'Geral', p.setor, p.profissional || p.medico || '-', p.horario_chamada || p.horario]);
  doc.autoTable({ startY: 40, head: [['Nº','Nome','Prioridade','Setor','Profissional','Horário']], body: data, theme: 'grid', headStyles: { fillColor: [26,79,196] }, alternateRowStyles: { fillColor: [240,244,255] } });
  const ds = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date()).replace(/\//g, '-');
  doc.save(`atendimentos_${ds}.pdf`); showToast('✅ PDF gerado com sucesso!');
}

// ====== RESET ======
async function resetData() {
  const senha = prompt('⚠️ RESETAR FILA DIÁRIA\n\nIsso limpará a fila ativa (histórico será preservado).\n\nDigite a senha administrativa:');
  if (!senha) return;
  try {
    const r = await fetch(`${API_URL}/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha }) });
    if (r.status === 403) { showToast('❌ Senha incorreta!', true); return; }
    if (!r.ok) throw new Error();
    showToast('✅ Fila zerada com sucesso!');
    setTimeout(() => window.location.reload(), 1500);
  } catch { showToast('❌ Erro ao resetar!', true); }
}

// ====== TOAST ======
function showToast(msg, error = false) {
  const t = document.getElementById('toast'); document.getElementById('toast-msg').textContent = msg;
  t.classList.toggle('error', error); t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3000);
}

// ====== INIT ======
initSectorScreens();
initOverview();
loadQueues(); loadCurrentCalling(); loadHistory(); loadAttended(); loadChat();

// ====== SOCKET.IO ======
const socket = io({ transports: ['websocket'], upgrade: false });
setInterval(() => { loadQueues(); loadCurrentCalling(); loadHistory(); loadAttended();
  fetch(`${API_URL}/chat`).then(r => r.json()).then(d => { if (d.length > chatMessages.length) { chatMessages = d; renderChat(); } }).catch(()=>{});
}, 3000);

socket.on('queueUpdate', () => { loadQueues(); loadCurrentCalling(); loadHistory(); loadAttended(); });
socket.on('callPatient', (d) => { speak(d.patient.nome, d.setor, d.audioUrl, d.patient.medico); loadQueues(); loadCurrentCalling(); loadHistory(); loadAttended(); });
socket.on('chatMessage', (msg) => {
  chatMessages.push(msg); renderChat();
  const at = document.querySelector('.nav-tab.active');
  if (at && at.id !== 'tab-chat') { unreadChatCount++; updateChatBadge(); showToast(`💬 Nova mensagem de ${msg.remetente}`); }
  else { const c = document.getElementById('chat-messages'); if (c) c.scrollTop = c.scrollHeight; }
});
socket.on('chatReset', () => { chatMessages = []; renderChat(); });
setTimeout(() => { document.getElementById('sound-modal').style.display = 'flex'; }, 600);
