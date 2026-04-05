// @ts-nocheck
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
let sectorFilters = { medico: null, enfermagem: null };

const CAPACITY_LIMITS = { 'Total': 30, 'Regulação': 10, 'Farmácia': 999, 'Médico': 999, 'Acolhimento': 999, 'Enfermagem': 999, 'Odontologia': 999 };

// ====== INIT: Generate sector screens ======
function initSectorScreens() {
  SETORES.forEach(setor => {
    const cfg = SECTOR_CONFIG[setor];
    const screenEl = document.getElementById('screen-' + cfg.key);
    if (!screenEl) return;

    // Filter buttons for Médico and Enfermagem only (Odontologia already done)
    let filterHTML = '';
    if (cfg.profissionais && setor !== 'Odontologia') {
      const firstProf = cfg.profissionais[0];
      const btns = cfg.profissionais.map((p, idx) =>
        `<button class="btn-filter${idx === 0 ? ' active' : ''}" data-prof="${p}" onclick="filterSector('${cfg.key}','${p}')">${p}</button>`
      ).join('');
      filterHTML = `
        <div style="margin-bottom:20px;">
          <label style="font-size:13px;font-weight:700;color:var(--gray-600);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;display:block;">Selecione seu Profissional</label>
          <div class="filter-bar" id="filter-bar-${cfg.key}" style="display:flex;gap:8px;flex-wrap:wrap;">
            ${btns}
          </div>
        </div>`;
      // Auto-set the first professional as default filter
      if (!sectorFilters[cfg.key]) {
        sectorFilters[cfg.key] = firstProf;
      }
    }

    let profHTML = '';
    if (cfg.profissionais) {
      const consultOpts = ['1','2','3','4','5','6','Odontológico'].map(c =>
        `<option value="${c}">${c === 'Odontológico' ? 'Cons. Odontológico' : 'Consultório ' + c}</option>`
      ).join('');
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
        ${filterHTML}
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
        <div style="margin-top:24px;padding-top:20px;border-top:2px solid var(--gray-200);">
          <div class="sector-header">
            <div class="sector-name"><div class="sector-dot" style="background:var(--green);"></div>✅ Atendidos Hoje</div>
            <span class="sector-count" style="background:var(--green);" id="cnt-attended-${cfg.key}">0</span>
          </div>
          <div class="queue-list" id="attended-${cfg.key}"></div>
        </div>
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

// ====== FILTER SECTOR ======
function filterSector(key, profissional) {
  if (!profissional) return; // Must select a specific professional
  sectorFilters[key] = profissional;
  const bar = document.getElementById('filter-bar-' + key);
  if (bar) {
    bar.querySelectorAll('.btn-filter').forEach(btn => {
      btn.classList.toggle('active', (btn.dataset.prof || '') === (profissional || ''));
    });
  }
  // Auto-set dropdown
  if (profissional) {
    const pEl = document.getElementById('profissional-' + key);
    if (pEl) pEl.value = profissional;
  }
  updateQueues();
  updateBadges();
  renderAllSectorAttended();
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

  const profGrupo = document.getElementById('profissional-grupo');
  if (profGrupo) {
    const showProf = ['Médico','Enfermagem'].includes(setor);
    profGrupo.style.display = showProf ? 'flex' : 'none';
    if (showProf) {
      const cfg = SECTOR_CONFIG[setor];
      const select = document.getElementById('input-profissional');
      select.innerHTML = '<option value="">— Selecione o profissional —</option>' +
        (cfg.profissionais || []).map(p => `<option value="${p}">${p}</option>`).join('');
    }
  }
}

// ====== ADD PATIENT ======
async function addPatient(btn) {
  const nome = document.getElementById('input-nome').value.trim();
  const setor = document.getElementById('input-setor').value;
  const prioridade = document.getElementById('input-prioridade').value;
  const tipo_prioridade = prioridade === 'prioritario' ? document.getElementById('input-tipo-prioridade').value : null;
  const tipo_atendimento = ['Médico','Enfermagem','Odontologia'].includes(setor) ? document.getElementById('input-tipo-atendimento').value : null;
  const profissionalEl = document.getElementById('input-profissional');
  const profissional = ['Médico','Enfermagem'].includes(setor) && profissionalEl ? profissionalEl.value || null : null;

  if (!nome) { showToast('Digite o nome do paciente!', true); return; }
  if (!setor) { showToast('Selecione o setor!', true); return; }
  if (['Médico','Enfermagem'].includes(setor) && !profissional) { showToast('Selecione o profissional responsável!', true); return; }

  if (btn) btn.disabled = true;
  try {
    const r = await fetch(`${API_URL}/patients`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome, setor, prioridade, tipo_prioridade, tipo_atendimento, profissional }) });
    if (!r.ok) throw new Error();
    const newPatient = await r.json();
    document.getElementById('input-nome').value = '';
    document.getElementById('input-setor').value = '';
    document.getElementById('input-prioridade').value = 'geral';
    togglePrioridadeDetalhes(); toggleTipoAtendimento();
    const prioLabel = prioridade === 'prioritario' ? ' ⭐ PRIORITÁRIO' : '';
    const profLabel = profissional ? ` (${profissional})` : '';
    showToast(`${nome} adicionado à fila de ${setor}${profLabel}!${prioLabel}`);
    await loadQueues();
    showQrModal(newPatient);
  } catch { showToast('Erro ao adicionar paciente!', true); }
  if (btn) btn.disabled = false;
}

let qrCodeInstance = null;
function showQrModal(p) {
  document.getElementById('qr-patient-name').textContent = p.nome;
  document.getElementById('qr-patient-sector').textContent = p.setor + (p.profissional ? ` - ${p.profissional}` : '');
  
  const qrContainer = document.getElementById('qrcode-container');
  qrContainer.innerHTML = '';
  
  const virtualUrl = `${window.location.origin}/virtual.html?id=${p.id}`;
  
  if (window.QRCode) {
    qrCodeInstance = new QRCode(qrContainer, {
      text: virtualUrl,
      width: 160,
      height: 160,
      colorDark : "#0a1e5c",
      colorLight : "#ffffff",
      correctLevel : QRCode.CorrectLevel.H
    });
  } else {
    qrContainer.innerHTML = '<span style="font-size:12px;color:red;">Erro ao gerar QR Code</span>';
  }
  
  document.getElementById('qr-modal').style.display = 'flex';
}

// ====== CALL NEXT ======
async function callNext(setor) {
  try {
    const cfg = SECTOR_CONFIG[setor];
    let consultorio = null, profissional = null, medico = null;
    const filtro_profissional = sectorFilters[cfg.key] || null;

    if (cfg.profissionais) {
      const cEl = document.getElementById('consultorio-' + cfg.key);
      const pEl = document.getElementById('profissional-' + cfg.key);
      consultorio = cEl ? cEl.value : null;
      profissional = pEl ? pEl.value : null;
      const consLabel = consultorio === 'Odontológico' ? 'Cons. Odontológico' : 'Consultório ' + consultorio;
      medico = `${consLabel} - ${profissional}`;
    }
    const r = await fetch(`${API_URL}/call-next/${setor}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ medico, consultorio, profissional, filtro_profissional }) });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
    loadQueues(); loadCurrentCalling();
  } catch (e) { showToast(e.message || `Fila de ${setor} está vazia!`, true); }
}

// ====== REMOVE PATIENT ======
async function removePatient(id, nome) {
  const senha = prompt(`🗑️ Excluir "${nome}" da fila?\n\nDigite a senha administrativa:`);
  if (!senha) return;
  try {
    const r = await fetch(`${API_URL}/remove-patient`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, senha }) });
    if (r.status === 403) { showToast('❌ Senha incorreta!', true); return; }
    if (!r.ok) throw new Error();
    showToast(`🗑️ ${nome} removido da fila`);
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

// ====== CHAT SOUND ======
function playChatSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880; osc.type = 'sine'; gain.gain.value = 0.3;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.stop(ctx.currentTime + 0.4);
    setTimeout(() => {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2); gain2.connect(ctx.destination);
      osc2.frequency.value = 1100; osc2.type = 'sine'; gain2.gain.value = 0.3;
      osc2.start();
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc2.stop(ctx.currentTime + 0.4);
    }, 200);
  } catch(e) { /* ignore audio errors */ }
}

// ====== LOAD DATA ======
async function loadQueues() { try { const r = await fetch(`${API_URL}/queues`); queues = await r.json(); SETORES.forEach(s => { if (!queues[s]) queues[s] = []; }); updateAll(); } catch (e) { console.error(e); } }
async function loadCurrentCalling() { try { const r = await fetch(`${API_URL}/current-calling`); const d = await r.json(); currentCalling = d.current; totalAtendidos = d.totalAtendidos || 0; totalDesistencias = d.totalDesistencias || 0; updateBanners(); updatePainel(); updateStats(); } catch (e) { console.error(e); } }
async function loadHistory() {
  try {
    const r = await fetch(`${API_URL}/history`);
    callHistory = await r.json();
    if (callHistory && callHistory.length) {
      const topId = callHistory[0].id;
      if (lastSpokenCallId !== null && topId !== lastSpokenCallId) {
        const p = callHistory[0];
        speakViaSynthesis(p.nome, p.setor, p.medico);
      }
      lastSpokenCallId = topId;
    }
    updatePainel();
    renderAllSectorAttended();
  } catch (e) { console.error(e); }
}
async function loadAttended() { try { const r = await fetch(`${API_URL}/attended`); attendedPatients = await r.json(); renderAttended(); } catch (e) { console.error(e); } }

// ====== UPDATE UI ======
function updateAll() { updateStats(); updateBadges(); updateQueues(); updateMiniQueues(); updateRecent(); renderAllSectorAttended(); }

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
    const cfg = SECTOR_CONFIG[setor];
    const allItems = (queues[setor] || []).filter(p => p.status === 'aguardando');
    const count = allItems.length;
    // Tab badge always shows total
    const badge = document.getElementById('badge-' + cfg.key); if (badge) badge.textContent = count;
    const cnt = document.getElementById('cnt-' + cfg.key); if (cnt) cnt.textContent = count + ' na fila';
    // Sector screen count shows filtered count
    const filter = sectorFilters[cfg.key] || null;
    const filteredCount = filter ? allItems.filter(p => p.profissional === filter).length : count;
    const cnt2 = document.getElementById('cnt2-' + cfg.key); if (cnt2) cnt2.textContent = filteredCount;
  });
}

function getColor(setor) { return SECTOR_CONFIG[setor]?.color || 'var(--blue)'; }

function renderQueueItems(containerId, setor, filterProfissional) {
  const el = document.getElementById(containerId); if (!el) return;
  let items = (queues[setor] || []).filter(p => p.status !== 'atendido' && p.status !== 'desistencia');
  if (filterProfissional) {
    items = items.filter(p => p.profissional === filterProfissional);
  }
  if (!items.length) { el.innerHTML = '<div class="empty-state"><div class="es-icon">✅</div><p>Fila vazia</p></div>'; return; }
  el.innerHTML = items.map((p, i) => {
    const prioBadge = p.prioridade === 'prioritario' ? `<span class="priority-badge">⭐ ${p.tipo_prioridade || 'PRIORITÁRIO'}</span>` : '';
    const tipoLabel = p.tipo_atendimento ? `<span style="font-size:11px;color:var(--gray-600);margin-left:4px;">(${p.tipo_atendimento})</span>` : '';
    const profLabel = p.profissional ? `<span style="font-size:11px;color:var(--blue);margin-left:4px;">👨‍⚕️ ${p.profissional}</span>` : '';
    const removeBtn = `<button class="btn-danger" onclick="event.stopPropagation();removePatient(${p.id},'${p.nome.replace(/'/g,"\\\\'")}')" title="Excluir da fila">🗑️</button>`;
    return `<div class="queue-item ${p.status==='chamado'?'calling':''}">
      <div class="queue-position" style="background:${p.status==='chamado'?'#b8860b':getColor(setor)}">${i+1}</div>
      <div class="queue-name">${p.nome}${prioBadge}${tipoLabel}${profLabel}</div>
      <div class="queue-time">${p.horario}</div>
      <span class="queue-status ${p.status==='chamado'?'status-calling':'status-waiting'}">${p.status==='chamado'?'📢 Chamando':'Aguardando'}</span>
      ${removeBtn}
    </div>`;
  }).join('');
}

function updateQueues() {
  SETORES.forEach(s => {
    const cfg = SECTOR_CONFIG[s];
    const filter = sectorFilters[cfg.key] || null;
    renderQueueItems('queue-' + cfg.key, s, filter);
  });
}

function updateMiniQueues() { SETORES.forEach(s => renderQueueItems('mini-queue-' + SECTOR_CONFIG[s].key, s)); }

function updateRecent() {
  const el = document.getElementById('recent-list');
  const all = []; SETORES.forEach(s => all.push(...(queues[s] || [])));
  if (!all.length) { el.innerHTML = '<div class="empty-state" style="padding:16px;"><div class="es-icon">🗒️</div><p>Nenhum cadastro ainda</p></div>'; return; }
  const sorted = all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
  el.innerHTML = sorted.map(p => {
    const cfg = SECTOR_CONFIG[p.setor] || {}; const prioBadge = p.prioridade === 'prioritario' ? ' ⭐' : '';
    const profLabel = p.profissional ? ` · ${p.profissional}` : '';
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--gray-100);border-radius:8px;border:1px solid var(--gray-200);">
      <div style="font-size:18px;">${cfg.icon||'📋'}</div>
      <div style="flex:1;"><div style="font-weight:700;font-size:14px;color:var(--gray-700);">${p.nome}${prioBadge}</div><div style="font-size:12px;color:var(--gray-600);">${p.setor}${profLabel} · ${p.horario}</div></div>
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
        <button class="btn btn-ghost" onclick="speakViaSynthesis('${p.nome.replace(/'/g,"\\\\'")}','${p.setor}','${(p.medico||'').replace(/'/g,"\\\\'")}')" style="padding:6px 12px;font-size:13px;">🔊</button>
      </div>
    </div>`;
  }).join('');
}

// ====== SECTOR ATTENDED HISTORY ======
function renderAllSectorAttended() {
  SETORES.forEach(setor => {
    const cfg = SECTOR_CONFIG[setor];
    const el = document.getElementById('attended-' + cfg.key);
    const cntEl = document.getElementById('cnt-attended-' + cfg.key);
    if (!el) return;

    const filter = sectorFilters[cfg.key] || null;
    let items = (callHistory || []).filter(p => p.setor === setor);
    if (filter) {
      items = items.filter(p => p.profissional === filter);
    }

    if (cntEl) cntEl.textContent = items.length;

    if (!items.length) {
      el.innerHTML = '<div class="empty-state" style="padding:16px;"><div class="es-icon">✅</div><p>Nenhum atendido ainda</p></div>';
      return;
    }

    el.innerHTML = items.map((p, i) => {
      const prioBadge = p.prioridade === 'prioritario' ? `<span class="priority-badge">⭐</span>` : '';
      const prof = p.profissional || '';
      const profLabel = prof ? `<span style="font-size:11px;color:var(--gray-600);"> · ${prof}</span>` : '';
      return `<div class="queue-item" style="border-left:4px solid var(--green);">
        <div class="queue-position" style="background:var(--green);">${items.length - i}</div>
        <div class="queue-name">${p.nome}${prioBadge}${profLabel}</div>
        <div class="queue-time">${p.horario_chamada || ''}</div>
        <span class="queue-status status-done">✅ Atendido</span>
      </div>`;
    }).join('');
  });
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

// ====== CHAT AVANÇADO COM CANAIS ======
const CANAIS = [
  { id:'geral', nome:'📢 Geral', desc:'Todos os setores' },
  { id:'acolhimento', nome:'💜 Acolhimento', desc:'Canal do Acolhimento' },
  { id:'farmacia', nome:'💊 Farmácia', desc:'Canal da Farmácia' },
  { id:'regulacao', nome:'📋 Regulação', desc:'Canal da Regulação' },
  { id:'medico', nome:'🩺 Médico', desc:'Canal Médico' },
  { id:'enfermagem', nome:'👩‍⚕️ Enfermagem', desc:'Canal da Enfermagem' },
  { id:'odontologia', nome:'🦷 Odontologia', desc:'Canal da Odontologia' },
  { id:'gerencia', nome:'🏛️ Gerência', desc:'Canal da Gerência' }
];
let activeCanal = 'geral';
let channelMessages = {};
let channelUnread = {};
let chatUrgent = false;
let typingTimeout = null;
CANAIS.forEach(c => { channelMessages[c.id] = []; channelUnread[c.id] = 0; });

// Restore saved setor
const savedSetor = localStorage.getItem('chatSetor');
if (savedSetor) { setTimeout(() => { const sel = document.getElementById('chat-remetente'); if (sel) sel.value = savedSetor; }, 100); }

function onChatSetorChange() {
  const v = document.getElementById('chat-remetente').value;
  localStorage.setItem('chatSetor', v);
  renderCanalList();
}

function getVisibleCanais() {
  const setor = document.getElementById('chat-remetente')?.value || 'Recepção';
  if (setor === 'Gerência') return CANAIS;
  const setorKey = setor.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z]/g,'');
  return CANAIS.filter(c => c.id === 'geral' || c.id === 'gerencia' || c.id === setorKey);
}

function renderCanalList() {
  const el = document.getElementById('chat-canal-list'); if (!el) return;
  const visible = getVisibleCanais();
  el.innerHTML = visible.map(c => {
    const unread = channelUnread[c.id] || 0;
    const badge = unread > 0 ? `<span class="chat-canal-badge">${unread}</span>` : '';
    return `<button class="chat-canal-btn ${c.id===activeCanal?'active':''}" onclick="switchCanal('${c.id}')">${c.nome}${badge}</button>`;
  }).join('');
}

function switchCanal(canalId) {
  activeCanal = canalId;
  const canal = CANAIS.find(c => c.id === canalId);
  document.getElementById('chat-canal-title').textContent = canal?.nome?.replace(/^[^\s]+\s/,'') || canalId;
  document.getElementById('chat-canal-sub').textContent = canal?.desc || '';
  document.getElementById('chat-canal-icon').textContent = canal?.nome?.split(' ')[0] || '📢';
  channelUnread[canalId] = 0;
  renderCanalList();
  renderChannelChat();
  // Mark as read
  const setor = document.getElementById('chat-remetente')?.value || 'Recepção';
  fetch(`${API_URL}/chat/read`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({canal:canalId,setor}) }).catch(()=>{});
}

async function loadChannelMessages(canalId) {
  try { const r = await fetch(`${API_URL}/chat/canais/${canalId}`); channelMessages[canalId] = await r.json(); } catch(e) { console.error(e); }
}

async function loadAllChannels() {
  for (const c of getVisibleCanais()) { await loadChannelMessages(c.id); }
  renderChannelChat();
  // Load unread counts
  const setor = document.getElementById('chat-remetente')?.value || 'Recepção';
  try { const r = await fetch(`${API_URL}/chat/unread/${encodeURIComponent(setor)}`); const d = await r.json(); Object.keys(d).forEach(k => { channelUnread[k] = d[k]; }); } catch(e){}
  renderCanalList();
}

function renderChannelChat() {
  const c = document.getElementById('chat-messages'); if (!c) return;
  const msgs = channelMessages[activeCanal] || [];
  const meu = document.getElementById('chat-remetente')?.value || '';
  if (!msgs.length) { c.innerHTML = '<div class="empty-state" style="margin:auto;"><div class="es-icon">💬</div><p>Nenhuma mensagem neste canal</p></div>'; return; }
  c.innerHTML = msgs.map(m => {
    const t = new Date(m.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    const isMe = m.autor === meu;
    const urgClass = m.urgente ? ' bubble-urgent bubble-urgent-anim' : '';
    const urgTag = m.urgente ? '<span style="color:var(--red);font-weight:800;">🚨 URGENTE</span> ' : '';
    return `<div class="chat-bubble ${isMe?'bubble-sent':'bubble-received'}${urgClass}"><div class="chat-meta"><span>${urgTag}${m.autor}</span></div><div>${m.texto}</div><div class="chat-time">${t}</div></div>`;
  }).join('');
  c.scrollTop = c.scrollHeight;
}

async function sendChatChannelMessage() {
  const autor = document.getElementById('chat-remetente').value;
  const inp = document.getElementById('chat-input');
  const texto = inp.value.trim();
  if (!texto) return;
  try {
    inp.disabled = true;
    const r = await fetch(`${API_URL}/chat/canais/${activeCanal}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({autor,texto,urgente:chatUrgent}) });
    if (r.ok) { inp.value = ''; chatUrgent = false; document.getElementById('chat-urgent-btn').classList.remove('active'); }
  } catch { showToast('Erro ao enviar!', true); }
  finally { inp.disabled = false; inp.focus(); }
}

function handleChatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatChannelMessage(); }
}

function handleChatTyping() {
  // Auto-resize textarea
  const ta = document.getElementById('chat-input');
  ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
}

function toggleUrgent() {
  chatUrgent = !chatUrgent;
  document.getElementById('chat-urgent-btn').classList.toggle('active', chatUrgent);
}

function toggleEmojiPicker() {
  const picker = document.getElementById('emoji-picker');
  picker.classList.toggle('show');
  if (picker.classList.contains('show') && !picker.innerHTML) {
    const emojis = ['😊','👍','👋','⚠️','✅','❌','🔴','📋','💊','🩺','❤️','🙏','👀','🎉','😂','🤔'];
    picker.innerHTML = emojis.map(e => `<button onclick="insertEmoji('${e}')">${e}</button>`).join('');
  }
}

function insertEmoji(emoji) {
  const inp = document.getElementById('chat-input');
  inp.value += emoji; inp.focus();
  document.getElementById('emoji-picker').classList.remove('show');
}

async function clearChatCanal() {
  const senha = prompt('Limpar canal? Digite a senha administrativa:');
  if (!senha) return;
  try {
    const r = await fetch(`${API_URL}/chat/canais/${activeCanal}/clear`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({senha}) });
    if (r.status === 403) { showToast('Senha incorreta!', true); return; }
    if (r.ok) { channelMessages[activeCanal] = []; renderChannelChat(); showToast('Canal limpo!'); }
  } catch { showToast('Erro!', true); }
}

function updateChatBadge() {
  const b = document.getElementById('badge-chat');
  const total = Object.values(channelUnread).reduce((s,v) => s+v, 0);
  if (b) { if (total > 0) { b.textContent = total; b.style.display = 'inline-block'; } else { b.style.display = 'none'; } }
}

// Desktop notifications
function requestNotifPermission() { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); }
function sendDesktopNotif(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') { new Notification(title, { body, icon:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><text y="32" font-size="32">🏥</text></svg>' }); }
}
requestNotifPermission();

// Legacy chat kept for inactivity alerts
async function loadChat() { /* noop – using channels now */ }
function renderChat() { renderChannelChat(); }
async function sendChatMessage() { await sendChatChannelMessage(); }

// ====== INACTIVITY CHECK ======
function checkInactivity() {
  const now = new Date();
  SETORES.forEach(setor => {
    (queues[setor] || []).forEach(p => {
      if (p.status !== 'aguardando' || alertedPatients.has(p.id)) return;
      const diff = (now - new Date(p.created_at)) / 60000;
      if (diff >= 20) {
        alertedPatients.add(p.id);
        fetch(`${API_URL}/chat/canais/geral`, { method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ autor:'🤖 Sistema', texto:`⚠️ ALERTA: ${p.nome} aguarda há ${Math.round(diff)} min na fila de ${setor}`, urgente:true })
        }).catch(()=>{});
      }
    });
  });
}
setInterval(checkInactivity, 60000);

// ====== AGENDAMENTOS ======
const WA_TEMPLATES = {
  lembrete: `Olá [NOME]! 😊\n\nLembramos que você tem uma consulta agendada na *USF Chico Mendes*:\n\n📅 Data: [DATA]\n⏰ Horário: [HORARIO]\n👨‍⚕️ Profissional: [PROFISSIONAL]\n📋 Tipo: [TIPO]\n\nPor favor, chegue com 15 minutos de antecedência e traga seus documentos.\n\n[OBS]\n\nAtenciosamente,\n*USF Chico Mendes* 🏥`,
  confirmacao: `Olá [NOME]! ✅\n\nSua consulta na *USF Chico Mendes* está *CONFIRMADA*:\n\n📅 [DATA] às [HORARIO]\n👨‍⚕️ [PROFISSIONAL]\n\nDocumentos necessários:\n✓ RG e CPF\n✓ Cartão SUS\n✓ Carteira de vacinação\n\n[OBS]\n\n*USF Chico Mendes* 🏥`,
  reagendamento: `Olá [NOME]! 🔄\n\nInformamos que sua consulta na *USF Chico Mendes* foi *REAGENDADA*:\n\n📅 Nova data: [DATA]\n⏰ Novo horário: [HORARIO]\n👨‍⚕️ [PROFISSIONAL]\n\n[OBS]\n\nPedimos desculpas pelo inconveniente.\n*USF Chico Mendes* 🏥`,
  preparo_exames: `Olá [NOME]! 🔬\n\nVocê tem exames agendados na *USF Chico Mendes*:\n\n📅 [DATA] às [HORARIO]\n\n*Preparos necessários:*\n[EXAMES]\n\n[OBS]\n\n*USF Chico Mendes* 🏥`
};

const EXAMES_CHECKLIST = ['Hemograma','Glicemia Jejum','Colesterol Total','Triglicerídeos','TSH','Urina EAS','Parasitológico','Ultrassom','ECG','PSA'];

function toggleChecklistExames() {
  const tpl = document.getElementById('agend-template').value;
  const grupo = document.getElementById('checklist-exames-grupo');
  const container = document.getElementById('checklist-exames');
  if (tpl === 'preparo_exames') {
    grupo.style.display = 'flex';
    if (!container.innerHTML) {
      container.innerHTML = EXAMES_CHECKLIST.map(e => `<label style="display:flex;align-items:center;gap:4px;padding:4px 10px;background:var(--gray-100);border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;"><input type="checkbox" value="${e}" style="cursor:pointer;"> ${e}</label>`).join('');
    }
  } else { grupo.style.display = 'none'; }
}

function buildWaMessage(agend) {
  const tpl = WA_TEMPLATES[agend.template] || WA_TEMPLATES.lembrete;
  const dataFmt = new Date(agend.data_agendamento+'T12:00:00').toLocaleDateString('pt-BR');
  let exames = '';
  if (agend.checklist_exames) {
    try { const arr = JSON.parse(agend.checklist_exames); exames = arr.map(e => `• ${e}: Jejum de 8h`).join('\n'); } catch(e) { exames = agend.checklist_exames; }
  }
  return tpl.replace(/\[NOME\]/g, agend.nome).replace(/\[DATA\]/g, dataFmt).replace(/\[HORARIO\]/g, agend.horario)
    .replace(/\[PROFISSIONAL\]/g, agend.profissional||'A definir').replace(/\[TIPO\]/g, agend.tipo_atendimento||'Consulta')
    .replace(/\[OBS\]/g, agend.observacoes ? `📝 Obs: ${agend.observacoes}` : '').replace(/\[EXAMES\]/g, exames||'Consulte a unidade');
}

async function criarAgendamento() {
  const nome = document.getElementById('agend-nome').value.trim();
  const telefone = document.getElementById('agend-telefone').value.trim().replace(/\D/g,'');
  const data_agendamento = document.getElementById('agend-data').value;
  const horario = document.getElementById('agend-horario').value.trim();
  const profissional = document.getElementById('agend-profissional').value;
  const tipo_atendimento = document.getElementById('agend-tipo').value;
  const template = document.getElementById('agend-template').value;
  const observacoes = document.getElementById('agend-obs').value.trim();
  let checklist_exames = null;
  if (template === 'preparo_exames') {
    const checked = [...document.querySelectorAll('#checklist-exames input:checked')].map(c => c.value);
    if (checked.length) checklist_exames = JSON.stringify(checked);
  }
  if (!nome||!telefone||!data_agendamento||!horario) { showToast('Preencha nome, telefone, data e horário!', true); return; }
  if (telefone.length < 10) { showToast('Telefone inválido!', true); return; }
  try {
    const r = await fetch(`${API_URL}/agendamentos`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({nome,telefone,data_agendamento,horario,profissional,tipo_atendimento,template,observacoes,checklist_exames}) });
    if (!r.ok) throw new Error();
    showToast('📅 Agendamento criado!');
    document.getElementById('agend-nome').value=''; document.getElementById('agend-telefone').value='';
    document.getElementById('agend-horario').value=''; document.getElementById('agend-obs').value='';
    loadAgendamentos();
  } catch { showToast('Erro ao agendar!', true); }
}

async function loadAgendamentos() {
  const data = document.getElementById('agend-filter-data')?.value || '';
  const status = document.getElementById('agend-filter-status')?.value || '';
  const params = new URLSearchParams(); if (data) params.set('data',data); if (status) params.set('status',status);
  try {
    const r = await fetch(`${API_URL}/agendamentos?${params}`);
    const list = await r.json();
    renderAgendamentos(list);
  } catch { showToast('Erro ao carregar agendamentos', true); }
}

function renderAgendamentos(list) {
  const tbody = document.getElementById('agend-tbody'); if (!tbody) return;
  if (!list.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--gray-600);">Nenhum agendamento</td></tr>'; return; }
  tbody.innerHTML = list.map(a => {
    const dataFmt = new Date(a.data_agendamento+'T12:00:00').toLocaleDateString('pt-BR');
    const statusCls = a.status.replace(/\s+/g,'_');
    return `<tr>
      <td><b>${a.nome}</b><br><span style="font-size:11px;color:var(--gray-600);">${a.telefone}</span></td>
      <td>${dataFmt}</td><td>${a.horario}</td><td>${a.profissional||'-'}</td>
      <td><span class="agend-status ${statusCls}">${a.status}</span></td>
      <td><div class="agend-actions">
        <button onclick="openWaPreview(${a.id})" title="WhatsApp">📲</button>
        <button onclick="updateAgendStatus(${a.id},'lembrete_enviado')" title="Marcar lembrete">📨</button>
        <button onclick="updateAgendStatus(${a.id},'confirmado')" title="Confirmado">✅</button>
        <button onclick="updateAgendStatus(${a.id},'cancelado')" title="Cancelar">❌</button>
      </div></td></tr>`;
  }).join('');
}

async function updateAgendStatus(id, status) {
  try {
    await fetch(`${API_URL}/agendamentos/${id}/status`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status}) });
    showToast('Status atualizado!'); loadAgendamentos();
  } catch { showToast('Erro!', true); }
}

async function openWaPreview(id) {
  try {
    const r = await fetch(`${API_URL}/agendamentos`);
    const list = await r.json();
    const agend = list.find(a => a.id === id);
    if (!agend) return;
    const msg = buildWaMessage(agend);
    document.getElementById('wa-preview-text').textContent = msg;
    const phone = agend.telefone.replace(/\D/g,'');
    document.getElementById('wa-send-link').href = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
    document.getElementById('wa-modal').classList.add('show');
  } catch { showToast('Erro!', true); }
}

function closeWaModal() { document.getElementById('wa-modal').classList.remove('show'); }

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
  const senha = prompt('⚠️ RESETAR FILA DIÁRIA\n\nIsso limpará a fila ativa.\n\nDigite a senha administrativa:');
  if (!senha) return;
  try {
    const r = await fetch(`${API_URL}/reset`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({senha}) });
    if (r.status === 403) { showToast('❌ Senha incorreta!', true); return; }
    if (!r.ok) throw new Error();
    showToast('✅ Fila zerada com sucesso!');
    setTimeout(() => window.location.reload(), 1500);
  } catch { showToast('❌ Erro ao resetar!', true); }
}

// ====== TOAST ======
function showToast(msg, error = false, duration = 3000) {
  const t = document.getElementById('toast'); document.getElementById('toast-msg').textContent = msg;
  t.classList.toggle('error', error); t.classList.add('show'); setTimeout(() => t.classList.remove('show'), duration);
}

// ====== INIT ======
initSectorScreens();
initOverview();
renderCanalList();
loadQueues(); loadCurrentCalling(); loadHistory(); loadAttended(); loadAllChannels();

// ====== SOCKET.IO ======
const socket = io({ transports: ['websocket'], upgrade: false });

setInterval(() => { loadQueues(); loadCurrentCalling(); loadHistory(); loadAttended(); }, 5000);
setInterval(() => { loadAllChannels(); }, 8000);

socket.on('queueUpdate', () => { loadQueues(); loadCurrentCalling(); loadHistory(); loadAttended(); });
socket.on('callPatient', (d) => { speak(d.patient.nome, d.setor, d.audioUrl, d.patient.medico); loadQueues(); loadCurrentCalling(); loadHistory(); loadAttended(); });
socket.on('chatChannelMessage', (data) => {
  const { canal, mensagem } = data;
  if (!channelMessages[canal]) channelMessages[canal] = [];
  if (channelMessages[canal].some(m => m.id === mensagem.id)) return;
  channelMessages[canal].push(mensagem);
  const at = document.querySelector('.nav-tab.active');
  const isChatScreen = at && at.id === 'tab-chat';
  if (canal === activeCanal && isChatScreen) {
    renderChannelChat();
  } else {
    channelUnread[canal] = (channelUnread[canal]||0) + 1;
    updateChatBadge(); renderCanalList();
  }
  if (!isChatScreen || canal !== activeCanal) {
    playChatSound();
    showToast(`💬 [${canal}] ${mensagem.autor}: ${mensagem.texto.substring(0,50)}`, false, 4000);
    if (mensagem.urgente) sendDesktopNotif('🚨 URGENTE - USF Chat', `${mensagem.autor}: ${mensagem.texto}`);
  }
});
socket.on('chatChannelClear', (data) => {
  if (data.canal === '__all__') { CANAIS.forEach(c => { channelMessages[c.id]=[]; channelUnread[c.id]=0; }); }
  else { channelMessages[data.canal]=[]; channelUnread[data.canal]=0; }
  renderChannelChat(); renderCanalList(); updateChatBadge();
});
socket.on('chatReset', () => { CANAIS.forEach(c => { channelMessages[c.id]=[]; channelUnread[c.id]=0; }); renderChannelChat(); renderCanalList(); });

setTimeout(() => { document.getElementById('sound-modal').style.display = 'flex'; }, 600);
