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
let attendedPatients = [];
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
async function addPatient(btn) {
  const nomeInput = document.getElementById('input-nome');
  const nome = nomeInput.value.trim();
  const setor = document.getElementById('input-setor').value;

  if (!nome) { showToast('Digite o nome do paciente!', true); return; }
  if (!setor) { showToast('Selecione o setor!', true); return; }

  // Disable button to prevent double clicks
  if (btn) btn.disabled = true;

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
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ====== CALL NEXT ======
async function callNext(setor) {
  try {
    const medicoSelect = document.getElementById('medico-' + setor);
    const medico = medicoSelect ? medicoSelect.value : null;

    const response = await fetch(`${API_URL}/call-next/${setor}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ medico })
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Erro ao chamar próximo');
    }

    // O backend agora emite evento via WebSocket para atualizar todos os clientes simultaneamente.
    // O áudio TTS e a atualização visual serão feitos pelo listener do Socket.io.
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
  const globalAudio = document.getElementById('global-audio');
  
  if (!audioUnlocked && 'speechSynthesis' in window) {
    const dummy = new SpeechSynthesisUtterance(' ');
    dummy.volume = 0;
    dummy.onend = () => { audioUnlocked = true; };
    window.speechSynthesis.speak(dummy);
    audioUnlocked = true;
  }
  
  if (globalAudio) {
    globalAudio.play().catch(() => {}); // Força o desbloqueio do elemento HTML
  }

  document.getElementById('sound-modal').style.display = 'none';
  showToast('🔊 Som ativado com sucesso!');
}

function speak(nome, setor, audioUrl, medico) {
  const globalAudio = document.getElementById('global-audio');

  if (globalAudio && audioUrl) {
    globalAudio.pause();
    globalAudio.currentTime = 0;
    globalAudio.src = audioUrl;
    globalAudio.play().catch(e => {
      console.warn('Autoplay bloqueado ou falhou. Usando Web Speech API...', e);
      // Fallback: use browser TTS if audio element fails
      speakViaSynthesis(nome, setor, medico);
    });
  } else {
    // No audioUrl from Google TTS — use browser's Web Speech API directly
    console.warn('Sem URL de áudio do servidor. Usando Web Speech API...');
    speakViaSynthesis(nome, setor, medico);
  }
}

// ====== WEB SPEECH API FALLBACK ======
function speakViaSynthesis(nome, setor, medico) {
  if (!('speechSynthesis' in window)) {
    console.error('Web Speech API não disponível neste navegador.');
    return;
  }
  window.speechSynthesis.cancel(); // cancel any ongoing speech
  // Saudação Dinâmica mais segura para navegadores antigos/TVs
  const currHour = new Date().getHours();
  const saudacao = currHour < 12 ? 'Bom dia' : currHour < 18 ? 'Boa tarde' : 'Boa noite';

  const destinoTexto = medico ? `ao ${medico}` : `à ${setor}`;
  const texto = `${saudacao}. Usuário ${nome}, dirija-se ${destinoTexto}.`;
  
  const utter = new SpeechSynthesisUtterance(texto);
  utter.lang = 'pt-BR';
  utter.rate = 0.9;
  utter.pitch = 1;
  // Try to find a Portuguese voice
  const voices = window.speechSynthesis.getVoices();
  const ptVoice = voices.find(v => v.lang.startsWith('pt'));
  if (ptVoice) utter.voice = ptVoice;
  window.speechSynthesis.speak(utter);
}

// ====== SPEAK PATIENT NAME (for public panel button) ======
function speakPatientName() {
  if (!callHistory || callHistory.length === 0) {
    showToast('Nenhuma chamada registrada!', true);
    return;
  }
  const last = callHistory[0];
  speakViaSynthesis(last.nome, last.setor, last.medico);
  showToast(`🔊 Chamando: ${last.nome}`);
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

async function loadAttended() {
  try {
    const response = await fetch(`${API_URL}/attended`);
    attendedPatients = await response.json();
    renderAttended();
  } catch (error) {
    console.error('Error loading attended:', error);
  }
}

function renderAttended() {
  const el = document.getElementById('attended-list');
  if (!el) return;
  
  // Update the nav badge
  const countEl = document.getElementById('attended-count');
  if (countEl) countEl.textContent = attendedPatients.length;
  // Update the big stat in the atendidos screen
  const countBigEl = document.getElementById('attended-count-big');
  if (countBigEl) countBigEl.textContent = attendedPatients.length;

  if (attendedPatients.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="es-icon">✅</div><p>Nenhum paciente atendido ainda</p></div>`;
    return;
  }

  el.innerHTML = attendedPatients.map((p, i) => {
    const icon = p.setor === 'Acolhimento' ? '💜' :
                 p.setor === 'Farmácia' ? '💊' :
                 p.setor === 'Regulação' ? '📋' :
                 p.setor === 'Renovação de Receita' ? '📄' : '🩺';
    const tagClass = p.setor === 'Farmácia' ? 'tag-farmacia' :
                     p.setor === 'Regulação' ? 'tag-regulacao' :
                     p.setor === 'Consulta' ? 'tag-consulta' :
                     p.setor === 'Acolhimento' ? 'tag-acolhimento' : 'tag-renovacao';
    return `
      <div class="queue-item" style="border-left: 4px solid var(--green);">
        <div class="queue-position" style="background:var(--green);">${attendedPatients.length - i}</div>
        <div class="queue-name">${p.nome}</div>
        <span class="sector-tag ${tagClass}">${icon} ${p.setor}</span>
        <div class="queue-time">${p.horario_chamada || p.horario}</div>
        <span class="queue-status status-done">✅ Atendido</span>
      </div>
    `;
  }).join('');
}

function repeatLastCall() {
  if (callHistory && callHistory.length > 0) {
    const last = callHistory[0];
    // Try Google TTS via currentCalling first, then fall back to Web Speech
    const setor = last.setor;
    if (currentCalling[setor] && currentCalling[setor].nome === last.nome) {
      speakAgain(setor);
    } else {
      // Use synthesis directly — most reliable for repeat
      speakViaSynthesis(last.nome, last.setor, last.medico);
    }
    showToast(`🔊 Repetindo: ${last.nome}`);
  } else {
    showToast('Nenhuma chamada no histórico!', true);
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
    let count = 0;
    if (queues[setor]) {
      count = queues[setor].filter(p => p.status === 'aguardando').length;
    }
    
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

  if (callHistory && callHistory.length > 0) {
    const latest = callHistory[0];
    const icon = latest.setor === 'Acolhimento' ? '💜' : 
                 latest.setor === 'Farmácia' ? '💊' : 
                 latest.setor === 'Regulação' ? '📋' : 
                 latest.setor === 'Renovação de Receita' ? '📄' : '🩺';
    
    // Check if there is a doctor to display
    let medicoHTML = '';
    if (latest.medico) {
      medicoHTML = `<div style="font-size:16px;opacity:0.8;margin-top:6px;font-weight:600;">👨‍⚕️ ${latest.medico}</div>`;
    }

    main.innerHTML = `
      <div class="painel-call-label">🔔 Chamando agora</div>
      <div class="painel-call-name">${latest.nome}</div>
      <div class="painel-call-sector">${icon} ${latest.setor}${medicoHTML}</div>
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
    const medicoDisplay = p.medico ? ` - <b>${p.medico}</b>` : '';
    return `
      <div class="painel-history-item">
        <div class="ph-number">${i + 1}</div>
        <div class="ph-info">
          <div class="ph-name">${p.nome}</div>
          <div class="ph-sector">${icon} ${p.setor}${medicoDisplay}</div>
        </div>
        <div class="ph-time">${p.horario_chamada}</div>
      </div>
    `;
  }).join('');
}

// ====== GENERATE PDF ======
function generatePDF() {
  if (attendedPatients.length === 0) {
    showToast('Não há pacientes para exportar.', true);
    return;
  }
  
  if (!window.jspdf || !window.jspdf.jsPDF) {
    showToast('Carregando biblioteca PDF, tente novamente em alguns segundos.', true);
    return; // Can happen if CDN hasn't fully loaded
  }
  
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Relatório de Atendimentos', 105, 20, { align: 'center' });
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text(`USF Chico Mendes | Data: ${new Date().toLocaleDateString('pt-BR')}`, 105, 28, { align: 'center' });
  
  const tableData = attendedPatients.map((p, index) => [
    attendedPatients.length - index,
    p.nome,
    p.setor + (p.medico ? ` (${p.medico})` : ''),
    p.horario_chamada || p.horario
  ]);
  
  doc.autoTable({
    startY: 40,
    head: [['Nº', 'Nome do Paciente', 'Setor / Médico', 'Horário']],
    body: tableData,
    theme: 'grid',
    headStyles: { fillColor: [26, 79, 196] },
    alternateRowStyles: { fillColor: [240, 244, 255] }
  });
  
  const formatter = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const dateStr = formatter.format(new Date()).replace(/\//g, '-');
  doc.save(`atendimentos_${dateStr}.pdf`);
  showToast('✅ PDF gerado com sucesso!');
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

// Load initial data
loadQueues();
loadCurrentCalling();
loadHistory();
loadAttended();

// ====== SOCKET.IO ======
// Forçar WebSockets para eliminar o delay do "Long Polling" inicial.
const socket = io({
  transports: ['websocket'],
  upgrade: false
});

// Fallback de segurança: caso a internet caia por microsegundos e perca o evento do socket,
// a tela ainda se corrige suavemente a cada 10 segundos sem o usuário perceber.
setInterval(() => {
  loadQueues();
  loadCurrentCalling();
}, 10000);

socket.on('queueUpdate', () => {
  loadQueues();
  loadCurrentCalling();
  loadHistory();
  loadAttended();
});

socket.on('callPatient', (data) => {
  const { patient, setor, audioUrl } = data;
  speak(patient.nome, setor, audioUrl, patient.medico);
  
  loadQueues();
  loadCurrentCalling();
  loadHistory();
  loadAttended();
});

setTimeout(() => {
  document.getElementById('sound-modal').style.display = 'flex';
}, 600);
