// API Base URL
const API_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:3000/api' 
  : '/api';

// ====== STATE ======
let queues = {
  'Acolhimento': [],
  'Farmácia': [],
  'Regulação': [],
  'Consulta': [],
  'Renovação de Receita': []
};

let currentCalling = {
  'Acolhimento': null,
  'Farmácia': null,
  'Regulação': null,
  'Consulta': null,
  'Renovação de Receita': null
};

let callHistory = [];
let recentAdded = [];
let totalAtendidos = 0;

// ====== CLOCK ======
function updateClock() {
  const now = new Date();
  const time = now.toLocaleTimeString('pt-BR');
  document.getElementById('clockDisplay').textContent = time;
  const date = now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  document.getElementById('dateDisplay').textContent = date.charAt(0).toUpperCase() + date.slice(1);
}
setInterval(updateClock, 1000);
updateClock();

// ====== SCREEN NAV ======
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
}

// ====== ADD PATIENT ======
async function addPatient() {
  const nome = document.getElementById('input-nome').value.trim();
  const setor = document.getElementById('input-setor').value;

  if (!nome) { showToast('Digite o nome do paciente!', true); return; }
  if (!setor) { showToast('Selecione o setor!', true); return; }

  try {
    const response = await fetch(`${API_URL}/patients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, setor })
    });

    if (!response.ok) throw new Error('Erro ao adicionar paciente');

    const patient = await response.json();
    
    document.getElementById('input-nome').value = '';
    document.getElementById('input-setor').value = '';

    showToast(`${nome} adicionado à fila de ${setor}!`);
    await loadQueues();
  } catch (error) {
    console.error('Error:', error);
    showToast('Erro ao adicionar paciente!', true);
  }
}

// ====== CALL NEXT ======
async function callNext(setor) {
  try {
    const response = await fetch(`${API_URL}/call-next/${setor}`, {
      method: 'POST'
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Erro ao chamar próximo');
    }

    const patient = await response.json();
    
    // Add to history
    callHistory.unshift({ 
      ...patient, 
      horarioChamada: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) 
    });
    if (callHistory.length > 10) callHistory.pop();

    // Announce
    speak(patient.nome, setor);
    await loadQueues();
    await loadCurrentCalling();
  } catch (error) {
    console.error('Error:', error);
    showToast(error.message || `Fila de ${setor} está vazia!`, true);
  }
}

// ====== SPEAK AGAIN ======
function speakAgain(setor) {
  if (currentCalling[setor]) {
    speak(currentCalling[setor].nome, setor);
  } else {
    showToast('Nenhum paciente sendo chamado!', true);
  }
}

// ====== TEXT-TO-SPEECH ======
let audioUnlocked = false;

function unlockAudio() {
  if (!audioUnlocked && 'speechSynthesis' in window) {
    const dummy = new SpeechSynthesisUtterance(' ');
    dummy.volume = 0;
    dummy.onend = () => { audioUnlocked = true; };
    window.speechSynthesis.speak(dummy);
    audioUnlocked = true;
  }
  document.getElementById('sound-modal').style.display = 'none';
  showToast('🔊 Som ativado com sucesso!');
}

function speak(nome, setor) {
  if (!('speechSynthesis' in window)) {
    showToast('Navegador não suporta síntese de voz!', true);
    return;
  }

  window.speechSynthesis.cancel();

  const saudacao = getGreeting();
  const texto = `${saudacao} ${nome}... comparecer à ${setor}... por favor.`;

  function doSpeak() {
    const msg = new SpeechSynthesisUtterance(texto);
    msg.lang = 'pt-BR';
    msg.rate = 0.82;
    msg.pitch = 1.0;
    msg.volume = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const ptVoice =
      voices.find(v => v.lang === 'pt-BR') ||
      voices.find(v => v.lang === 'pt-PT') ||
      voices.find(v => v.lang.startsWith('pt')) ||
      null;

    if (ptVoice) {
      msg.voice = ptVoice;
    }

    msg.onerror = (e) => {
      console.warn('TTS error:', e.error);
      const retry = new SpeechSynthesisUtterance(texto);
      retry.lang = 'pt-BR';
      retry.rate = 0.82;
      retry.volume = 1.0;
      window.speechSynthesis.speak(retry);
    };

    window.speechSynthesis.speak(msg);
  }

  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) {
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.onvoiceschanged = null;
      doSpeak();
    };
  } else {
    doSpeak();
  }
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia,';
  if (h < 18) return 'Boa tarde,';
  return 'Boa noite,';
}

// ====== LOAD DATA FROM API ======
async function loadQueues() {
  try {
    const response = await fetch(`${API_URL}/queues`);
    queues = await response.json();
    updateAll();
  } catch (error) {
    console.error('Error loading queues:', error);
  }
}

async function loadCurrentCalling() {
  try {
    const response = await fetch(`${API_URL}/current-calling`);
    const data = await response.json();
    currentCalling = data.current;
    totalAtendidos = data.totalAtendidos || 0;
    updateBanners();
    updatePainel();
    updateStats(); // Atualizar o contador global
  } catch (error) {
    console.error('Error loading current calling:', error);
  }
}

async function loadHistory() {
  try {
    const response = await fetch(`${API_URL}/history`);
    callHistory = await response.json();
    updatePainel();
  } catch (error) {
    console.error('Error loading history:', error);
  }
}

// ====== UPDATE ALL UI ======
function updateAll() {
  updateStats();
  updateBadges();
  updateQueues();
  updateMiniQueues();
  updateRecent();
}

function updateStats() {
  const a = queues['Acolhimento'].filter(p => p.status === 'aguardando').length;
  const f = queues['Farmácia'].filter(p => p.status === 'aguardando').length;
  const r = queues['Regulação'].filter(p => p.status === 'aguardando').length;
  const c = queues['Consulta'].filter(p => p.status === 'aguardando').length;
  const rev = queues['Renovação de Receita'].filter(p => p.status === 'aguardando').length;
  
  document.getElementById('stat-total').textContent = a + f + r + c + rev;
  
  const elFarm = document.getElementById('stat-farm');
  if (elFarm) elFarm.textContent = f;
  const elReg = document.getElementById('stat-reg');
  if (elReg) elReg.textContent = r;
  const elCons = document.getElementById('stat-cons');
  if (elCons) elCons.textContent = c;
  
  const elTotalAtendidos = document.getElementById('stat-atendidos');
  if (elTotalAtendidos) {
    elTotalAtendidos.textContent = totalAtendidos;
  }
}

function updateBadges() {
  const sectorMap = { 
    'Acolhimento': 'acolhimento',
    'Farmácia': 'farm', 
    'Regulação': 'reg', 
    'Consulta': 'cons',
    'Renovação de Receita': 'renovacao'
  };
  
  Object.entries(sectorMap).forEach(([setor, key]) => {
    const count = queues[setor]?.filter(p => p.status === 'aguardando').length || 0;
    
    // Update tab badges
    const badgeId = 'badge-' + (setor === 'Farmácia' ? 'farmacia' : 
                                setor === 'Regulação' ? 'regulacao' : 
                                setor === 'Acolhimento' ? 'acolhimento' :
                                setor === 'Renovação de Receita' ? 'renovacao' : 'consulta');
                                
    const badgeEl = document.getElementById(badgeId);
    if (badgeEl) badgeEl.textContent = count;
    
    // Update overview counts (Recepcao)
    const cntId = 'cnt-' + (setor === 'Acolhimento' ? 'acolh' : key === 'renovacao' ? 'renov' : key);
    if (document.getElementById(cntId)) {
      document.getElementById(cntId).textContent = count + ' na fila';
    }
    
    // Update sector screen counts
    const cnt2Id = 'cnt2-' + (setor === 'Acolhimento' ? 'acolh' : key === 'renovacao' ? 'renov' : key);
    if (document.getElementById(cnt2Id)) {
      document.getElementById(cnt2Id).textContent = count;
    }
  });
}

function renderQueueItems(container, setor, mini = false) {
  const el = document.getElementById(container);
  const items = queues[setor].filter(p => p.status !== 'atendido');
  if (items.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="es-icon">✅</div><p>Fila vazia</p></div>`;
    return;
  }
  el.innerHTML = items.map((p, i) => `
    <div class="queue-item ${p.status === 'chamado' ? 'calling' : ''}">
      <div class="queue-position" style="background:${p.status==='chamado'?'#b8860b':getColor(setor)}">${i + 1}</div>
      <div class="queue-name">${p.nome}</div>
      <div class="queue-time">${p.horario}</div>
      <span class="queue-status ${p.status === 'chamado' ? 'status-calling' : 'status-waiting'}">
        ${p.status === 'chamado' ? '📢 Chamando' : 'Aguardando'}
      </span>
    </div>
  `).join('');
}

function getColor(setor) {
  if (setor === 'Acolhimento') return 'var(--purple)';
  if (setor === 'Farmácia') return 'var(--green)';
  if (setor === 'Regulação') return 'var(--blue)';
  if (setor === 'Renovação de Receita') return 'var(--teal)';
  return 'var(--orange)';
}

function updateQueues() {
  renderQueueItems('queue-acolhimento', 'Acolhimento');
  renderQueueItems('queue-farmacia', 'Farmácia');
  renderQueueItems('queue-regulacao', 'Regulação');
  renderQueueItems('queue-consulta', 'Consulta');
  renderQueueItems('queue-renovacao', 'Renovação de Receita');
}

function updateMiniQueues() {
  renderQueueItems('mini-queue-acolhimento', 'Acolhimento', true);
  renderQueueItems('mini-queue-farmacia', 'Farmácia', true);
  renderQueueItems('mini-queue-regulacao', 'Regulação', true);
  renderQueueItems('mini-queue-consulta', 'Consulta', true);
  renderQueueItems('mini-queue-renovacao', 'Renovação de Receita', true);
}

function updateRecent() {
  const el = document.getElementById('recent-list');
  const allPatients = [
    ...(queues['Acolhimento'] || []),
    ...(queues['Farmácia'] || []),
    ...(queues['Regulação'] || []),
    ...(queues['Consulta'] || []),
    ...(queues['Renovação de Receita'] || [])
  ];
  
  if (allPatients.length === 0) {
    el.innerHTML = `<div class="empty-state" style="padding:16px;"><div class="es-icon">🗒️</div><p>Nenhum cadastro ainda</p></div>`;
    return;
  }
  
  const sorted = allPatients.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);

  el.innerHTML = sorted.map(p => {
    const icon = p.setor === 'Acolhimento' ? '💜' : 
                 p.setor === 'Farmácia' ? '💊' : 
                 p.setor === 'Regulação' ? '📋' : 
                 p.setor === 'Renovação de Receita' ? '📄' : '🩺';
                 
    return `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--gray-100);border-radius:8px;border:1px solid var(--gray-200);">
      <div style="font-size:18px;">${icon}</div>
      <div style="flex:1;">
        <div style="font-weight:700;font-size:14px;color:var(--gray-700);">${p.nome}</div>
        <div style="font-size:12px;color:var(--gray-600);">${p.setor} · ${p.horario}</div>
      </div>
    </div>
  `}).join('');
}

function updateBanners() {
  ['Acolhimento', 'Farmácia', 'Regulação', 'Consulta', 'Renovação de Receita'].forEach(setor => {
    const key = setor === 'Acolhimento' ? 'acolhimento' :
                setor === 'Farmácia' ? 'farmacia' : 
                setor === 'Regulação' ? 'regulacao' : 
                setor === 'Renovação de Receita' ? 'renovacao' : 'consulta';
    const banner = document.getElementById('banner-' + key);
    const nameEl = document.getElementById('banner-name-' + key);
    if (banner && nameEl) {
      if (currentCalling[setor]) {
        banner.classList.add('visible');
        nameEl.textContent = currentCalling[setor].nome;
      } else {
        banner.classList.remove('visible');
      }
    }
  });
}

function updatePainel() {
  const main = document.getElementById('painel-main');

  const allCalling = Object.entries(currentCalling)
    .filter(([_, p]) => p !== null)
    .map(([setor, p]) => ({ setor, ...p }));

  if (allCalling.length > 0) {
    const latest = allCalling[allCalling.length - 1];
    const icon = latest.setor === 'Acolhimento' ? '💜' : 
                 latest.setor === 'Farmácia' ? '💊' : 
                 latest.setor === 'Regulação' ? '📋' : 
                 latest.setor === 'Renovação de Receita' ? '📄' : '🩺';
    main.innerHTML = `
      <div class="painel-call-label">🔔 Chamando agora</div>
      <div class="painel-call-name">${latest.nome}</div>
      <div class="painel-call-sector">${icon} ${latest.setor}</div>
    `;
  } else {
    main.innerHTML = `<div class="painel-empty">⏳ Aguardando chamadas...</div>`;
  }

  const histEl = document.getElementById('painel-history');
  if (callHistory.length === 0) {
    histEl.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:rgba(255,255,255,0.3);padding:24px;font-size:14px;font-weight:600;">Nenhuma chamada registrada</div>`;
    return;
  }
  histEl.innerHTML = callHistory.map((p, i) => {
    const icon = p.setor === 'Acolhimento' ? '💜' : 
                 p.setor === 'Farmácia' ? '💊' : 
                 p.setor === 'Regulação' ? '📋' : 
                 p.setor === 'Renovação de Receita' ? '📄' : '🩺';
    return `
      <div class="painel-history-item">
        <div class="ph-number">${i + 1}</div>
        <div class="ph-info">
          <div class="ph-name">${p.nome}</div>
          <div class="ph-sector">${icon} ${p.setor}</div>
        </div>
        <div class="ph-time">${p.horarioChamada}</div>
      </div>
    `;
  }).join('');
}

// ====== TOAST ======
function showToast(msg, error = false) {
  const toast = document.getElementById('toast');
  const msgEl = document.getElementById('toast-msg');
  msgEl.textContent = msg;
  toast.classList.toggle('error', error);
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// ====== RESET DATA ======
async function resetData() {
  if (confirm("⚠️ TEM CERTEZA QUE DESEJA APAGAR TODA A FILA E HISTÓRICO?\n\nIsso limpará os dados de hoje e reiniciará as senhas. Esta ação não pode ser desfeita.")) {
    try {
      const response = await fetch(`${API_URL}/reset`, { method: 'POST' });
      if (!response.ok) throw new Error('Erro ao resetar dados');
      showToast('✅ Fila zerada com sucesso!');
      setTimeout(() => window.location.reload(), 1500);
    } catch (error) {
      console.error('Error:', error);
      showToast('❌ Erro ao resetar a fila!', true);
    }
  }
}

// ====== INIT ======
if ('speechSynthesis' in window) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

// Load initial data
loadQueues();
loadCurrentCalling();
loadHistory();

// Auto-refresh every 5 seconds
setInterval(() => {
  loadQueues();
  loadCurrentCalling();
}, 5000);

setTimeout(() => {
  document.getElementById('sound-modal').style.display = 'flex';
}, 600);
