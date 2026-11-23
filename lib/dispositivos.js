// @ts-nocheck
const crypto = require('crypto');
const {
  appendSetCookie,
  isProdEnv,
  isPublicApiRoute,
  getSessionFromRequest
} = require('./seguranca');

// Cache em memória de status dos dispositivos (60 segundos de TTL para economizar banco no Neon/Vercel)
const deviceStatusCache = new Map();
const CACHE_TTL_MS = 60000;

const MAX_TENTATIVAS_ANTES_BLOQUEIO = 5;
const MAX_TENTATIVAS_EMERGENCIA = 3;
const DURACAO_BLOQUEIO_TEMP_MS = 5 * 60 * 1000; // 5 minutos

let _colunasTentativasGarantidas = false;

function calcularEstadoBloqueioAtual(dispositivo, nowMs = Date.now()) {
  if (!dispositivo) {
    return {
      bloqueadoDefinitivo: false,
      bloqueioTemporario: false,
      emergenciaBloqueada: false,
      tentativasEmergencia: 0,
      lockedUntil: null,
      retryAfterSec: 0,
      tentativasFalhas: 0,
      bloqueioEtapa: 0,
      motivoBloqueio: null
    };
  }
  const tentativasEmerg = Number(dispositivo.tentativas_emergencia || 0);
  const emergBloq = Boolean(dispositivo.emergencia_bloqueada || tentativasEmerg >= MAX_TENTATIVAS_EMERGENCIA);
  if (dispositivo.ativo === false || emergBloq) {
    return {
      bloqueadoDefinitivo: true,
      bloqueioTemporario: false,
      emergenciaBloqueada: emergBloq,
      tentativasEmergencia: tentativasEmerg,
      lockedUntil: null,
      retryAfterSec: 0,
      tentativasFalhas: Number(dispositivo.tentativas_falhas || 0),
      bloqueioEtapa: Number(dispositivo.bloqueio_etapa || 2),
      motivoBloqueio: emergBloq ? 'bloqueio_total_emergencia' : (dispositivo.motivo_bloqueio || 'bloqueado')
    };
  }
  const untilMs = dispositivo.bloqueio_temporario_ate ? new Date(dispositivo.bloqueio_temporario_ate).getTime() : 0;
  if (untilMs && untilMs > nowMs) {
    return {
      bloqueadoDefinitivo: false,
      bloqueioTemporario: true,
      emergenciaBloqueada: false,
      tentativasEmergencia: tentativasEmerg,
      lockedUntil: new Date(untilMs).toISOString(),
      retryAfterSec: Math.max(1, Math.ceil((untilMs - nowMs) / 1000)),
      tentativasFalhas: Number(dispositivo.tentativas_falhas || MAX_TENTATIVAS_ANTES_BLOQUEIO),
      bloqueioEtapa: Number(dispositivo.bloqueio_etapa || 1),
      motivoBloqueio: dispositivo.motivo_bloqueio || null
    };
  }
  return {
    bloqueadoDefinitivo: false,
    bloqueioTemporario: false,
    emergenciaBloqueada: false,
    tentativasEmergencia: tentativasEmerg,
    lockedUntil: null,
    retryAfterSec: 0,
    tentativasFalhas: Number(dispositivo.tentativas_falhas || 0),
    bloqueioEtapa: Number(dispositivo.bloqueio_etapa || 0),
    motivoBloqueio: dispositivo.motivo_bloqueio || null
  };
}

function calcularProximoEstadoFalha(dispositivo, nowMs = Date.now()) {
  const atual = calcularEstadoBloqueioAtual(dispositivo, nowMs);
  if (atual.bloqueadoDefinitivo) {
    return {
      action: 'device_blocked',
      status: 423,
      ativo: false,
      tentativas_falhas: atual.tentativasFalhas,
      bloqueio_etapa: 2,
      bloqueio_temporario_ate: null,
      motivo_bloqueio: atual.motivoBloqueio || 'excesso_tentativas',
      retryAfterSec: 0
    };
  }
  if (atual.bloqueioTemporario) {
    return {
      action: 'temp_locked',
      status: 429,
      ativo: true,
      tentativas_falhas: atual.tentativasFalhas,
      bloqueio_etapa: atual.bloqueioEtapa || 1,
      bloqueio_temporario_ate: atual.lockedUntil,
      motivo_bloqueio: atual.motivoBloqueio,
      retryAfterSec: atual.retryAfterSec
    };
  }
  if (atual.bloqueioEtapa >= 1) {
    return {
      action: 'block_device_permanent',
      status: 423,
      ativo: false,
      tentativas_falhas: atual.tentativasFalhas + 1,
      bloqueio_etapa: 2,
      bloqueio_temporario_ate: null,
      motivo_bloqueio: 'excesso_tentativas',
      retryAfterSec: 0
    };
  }
  const novasTentativas = atual.tentativasFalhas + 1;
  if (novasTentativas >= MAX_TENTATIVAS_ANTES_BLOQUEIO) {
    const untilIso = new Date(nowMs + DURACAO_BLOQUEIO_TEMP_MS).toISOString();
    return {
      action: 'temp_lock_5m',
      status: 429,
      ativo: true,
      tentativas_falhas: novasTentativas,
      bloqueio_etapa: 1,
      bloqueio_temporario_ate: untilIso,
      motivo_bloqueio: 'tentativas_5min',
      retryAfterSec: Math.ceil(DURACAO_BLOQUEIO_TEMP_MS / 1000)
    };
  }
  return {
    action: 'warn',
    status: 401,
    ativo: true,
    tentativas_falhas: novasTentativas,
    restantes: MAX_TENTATIVAS_ANTES_BLOQUEIO - novasTentativas,
    bloqueio_etapa: 0,
    bloqueio_temporario_ate: null,
    motivo_bloqueio: null,
    retryAfterSec: 0
  };
}

async function garantirColunasTentativasDispositivos(pool) {
  if (_colunasTentativasGarantidas || !pool || typeof pool.query !== 'function') return;
  try {
    await pool.query(`ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS tentativas_falhas INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS bloqueio_temporario_ate TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS bloqueio_etapa INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS motivo_bloqueio TEXT`);
    await pool.query(`ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS tentativas_emergencia INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS emergencia_bloqueada BOOLEAN DEFAULT false`);
    _colunasTentativasGarantidas = true;
  } catch (e) {}
}

function calcularProximoEstadoFalhaEmergencia(dispositivo) {
  const prev = Number(dispositivo?.tentativas_emergencia || 0);
  if (dispositivo?.emergencia_bloqueada || prev >= MAX_TENTATIVAS_EMERGENCIA) {
    return {
      blockedTotal: true,
      status: 423,
      ativo: false,
      tentativas_emergencia: Math.max(prev, MAX_TENTATIVAS_EMERGENCIA),
      emergencia_bloqueada: true,
      restantes: 0,
      motivo_bloqueio: 'bloqueio_total_emergencia'
    };
  }
  const next = prev + 1;
  if (next >= MAX_TENTATIVAS_EMERGENCIA) {
    return {
      blockedTotal: true,
      status: 423,
      ativo: false,
      tentativas_emergencia: next,
      emergencia_bloqueada: true,
      restantes: 0,
      motivo_bloqueio: 'bloqueio_total_emergencia'
    };
  }
  return {
    blockedTotal: false,
    status: 403,
    ativo: dispositivo?.ativo !== false,
    tentativas_emergencia: next,
    emergencia_bloqueada: false,
    restantes: MAX_TENTATIVAS_EMERGENCIA - next,
    motivo_bloqueio: dispositivo?.motivo_bloqueio || null
  };
}

async function obterOuCriarDispositivoAuth(req, res, pool) {
  await garantirColunasTentativasDispositivos(pool);
  let deviceId = getDeviceId(req);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    setDeviceCookie(res, deviceId);
  } else {
    const cookies = parseCookies(req);
    if (!cookies.usf_did || cookies.usf_did !== deviceId) {
      setDeviceCookie(res, deviceId);
    }
  }
  const ip = getClientIp(req);
  const ua = parseUserAgent(req.headers['user-agent']);
  await pool.query(
    `INSERT INTO dispositivos (id, nome, setor, ultimo_ip, user_agent, primeiro_acesso, ultimo_acesso, ativo)
     VALUES ($1, 'Sem nome', NULL, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, true)
     ON CONFLICT (id) DO NOTHING`,
    [deviceId, ip, ua]
  );
  const sel = await pool.query(
    `SELECT id, nome, setor, ativo, tentativas_falhas, bloqueio_temporario_ate, bloqueio_etapa, motivo_bloqueio,
            COALESCE(tentativas_emergencia, 0) AS tentativas_emergencia,
            COALESCE(emergencia_bloqueada, false) AS emergencia_bloqueada
     FROM dispositivos WHERE id = $1 LIMIT 1`,
    [deviceId]
  );
  return { deviceId, row: sel.rows[0] || null };
}

async function consultarEstadoBloqueioDispositivo(req, pool) {
  const deviceId = getDeviceId(req);
  if (!deviceId || !pool || typeof pool.query !== 'function') {
    return { deviceId: deviceId || null, ...calcularEstadoBloqueioAtual(null) };
  }
  await garantirColunasTentativasDispositivos(pool);
  const sel = await pool.query(
    `SELECT id, nome, setor, ativo, tentativas_falhas, bloqueio_temporario_ate, bloqueio_etapa, motivo_bloqueio,
            COALESCE(tentativas_emergencia, 0) AS tentativas_emergencia,
            COALESCE(emergencia_bloqueada, false) AS emergencia_bloqueada
     FROM dispositivos WHERE id = $1 LIMIT 1`,
    [deviceId]
  );
  const row = sel.rows[0] || null;
  return { deviceId, row, ...calcularEstadoBloqueioAtual(row) };
}

async function registrarFalhaAuthDispositivo(req, res, pool) {
  const { deviceId, row } = await obterOuCriarDispositivoAuth(req, res, pool);
  const next = calcularProximoEstadoFalha(row);
  await pool.query(
    `UPDATE dispositivos
     SET tentativas_falhas = $2,
         bloqueio_etapa = $3,
         bloqueio_temporario_ate = $4,
         ativo = $5,
         motivo_bloqueio = $6,
         ultimo_acesso = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [
      deviceId,
      next.tentativas_falhas,
      next.bloqueio_etapa,
      next.bloqueio_temporario_ate,
      next.ativo,
      next.motivo_bloqueio
    ]
  );
  if (next.ativo === false) {
    deviceStatusCache.set(deviceId, {
      ativo: false,
      nome: (row && row.nome) || 'Sem nome',
      expiresAt: Date.now() + CACHE_TTL_MS
    });
  }
  return { deviceId, ...next };
}

async function registrarFalhaEmergenciaDispositivo(req, res, pool) {
  const { deviceId, row } = await obterOuCriarDispositivoAuth(req, res, pool);
  const next = calcularProximoEstadoFalhaEmergencia(row);
  await pool.query(
    `UPDATE dispositivos
     SET tentativas_emergencia = $2,
         emergencia_bloqueada = $3,
         ativo = $4,
         motivo_bloqueio = $5,
         ultimo_acesso = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [
      deviceId,
      next.tentativas_emergencia,
      next.emergencia_bloqueada,
      next.ativo,
      next.motivo_bloqueio
    ]
  );
  if (next.ativo === false || next.emergencia_bloqueada) {
    deviceStatusCache.set(deviceId, {
      ativo: false,
      nome: (row && row.nome) || 'Sem nome',
      expiresAt: Date.now() + CACHE_TTL_MS
    });
  }
  return { deviceId, ...next };
}

async function resetarTentativasAuthDispositivo(pool, deviceId, desbloquear = false) {
  if (!deviceId || !pool || typeof pool.query !== 'function') return;
  await garantirColunasTentativasDispositivos(pool);
  await pool.query(
    `UPDATE dispositivos
     SET tentativas_falhas = 0,
         bloqueio_etapa = 0,
         bloqueio_temporario_ate = NULL,
         tentativas_emergencia = 0,
         emergencia_bloqueada = false,
         motivo_bloqueio = NULL,
         ativo = CASE WHEN $2 THEN true ELSE ativo END,
         ultimo_acesso = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [deviceId, Boolean(desbloquear)]
  );
  deviceStatusCache.delete(deviceId);
}

const CONFIG_CHAVE_BLOQUEIO_SEM_NOME = 'bloquear_dispositivos_sem_nome';
const _strictConfigCache = { enabled: false, checkedAt: 0 };
const STRICT_CONFIG_TTL_MS = 15000;

function isNomeDispositivoValido(nome) {
  const s = String(nome || '').trim();
  return Boolean(s) && s.toLowerCase() !== 'sem nome';
}

function isRotaIsentaBloqueioDispositivo(method, fullPath) {
  const p = String(fullPath || '').split('?')[0];
  if (!p || !p.startsWith('/api')) return true;
  const subPath = p.slice(4) || '/';
  if (subPath === '/admin' || subPath.startsWith('/admin/')) return true;
  if (subPath === '/dispositivos/acesso') return true;
  return isPublicApiRoute(method, subPath);
}

function avaliarAcessoDispositivo({ deviceId, dispositivo, bloquearSemNome, isAdmin }) {
  if (dispositivo && dispositivo.ativo === false) {
    if (isAdmin) {
      return { permitido: true, motivo: null, code: null, error: null };
    }
    return {
      permitido: false,
      motivo: 'bloqueado',
      code: 'DEVICE_BLOCKED',
      error: 'Dispositivo bloqueado pelo administrador. Acesso negado.'
    };
  }

  if (!bloquearSemNome) {
    return { permitido: true, motivo: null, code: null, error: null };
  }

  if (isAdmin) {
    return { permitido: true, motivo: null, code: null, error: null };
  }

  if (!deviceId || !dispositivo || !isNomeDispositivoValido(dispositivo.nome)) {
    return {
      permitido: false,
      motivo: 'sem_nome',
      code: 'DEVICE_UNNAMED',
      error: 'Dispositivo não cadastrado. Solicite a liberação à coordenação.'
    };
  }

  return { permitido: true, motivo: null, code: null, error: null };
}

function setBloqueioSemNomeCache(enabled) {
  _strictConfigCache.enabled = Boolean(enabled);
  _strictConfigCache.checkedAt = Date.now();
}

async function isBloqueioSemNomeAtivo(pool, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && (now - _strictConfigCache.checkedAt) < STRICT_CONFIG_TTL_MS) {
    return _strictConfigCache.enabled;
  }
  if (!pool || typeof pool.query !== 'function') {
    return _strictConfigCache.enabled;
  }
  try {
    const r = await pool.query(
      'SELECT valor FROM configuracoes WHERE chave = $1 LIMIT 1',
      [CONFIG_CHAVE_BLOQUEIO_SEM_NOME]
    );
    const val = String(r.rows[0]?.valor || '').trim().toLowerCase();
    const enabled = val === 'true' || val === '1';
    setBloqueioSemNomeCache(enabled);
    return enabled;
  } catch (e) {
    return false;
  }
}

// Extrair e sanitizar IP (pega primeiro de x-forwarded-for ou remoteAddress)
function getClientIp(req) {
  let ip = '';
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    ip = String(forwarded).split(',')[0].trim();
  } else if (req.socket && req.socket.remoteAddress) {
    ip = req.socket.remoteAddress;
  }

  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }

  // Sanitizar formato IPv4 ou IPv6
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Regex = /^[0-9a-fA-F:]+$/;
  if (ipv4Regex.test(ip) || ipv6Regex.test(ip)) {
    return ip;
  }
  return 'Desconhecido';
}

// Resumir User Agent para conformidade LGPD (não armazenar fingerprints excessivos)
function parseUserAgent(uaHeader) {
  if (!uaHeader || typeof uaHeader !== 'string') return 'Desconhecido';
  const ua = uaHeader.toLowerCase();

  let browser = 'Navegador';
  if (ua.includes('edg/')) {
    const match = uaHeader.match(/Edg\/(\d+)/i);
    browser = `Edge ${match ? match[1] : ''}`.trim();
  } else if (ua.includes('samsungbrowser')) {
    browser = 'Samsung Internet';
  } else if (ua.includes('chrome') && !ua.includes('chromium')) {
    const match = uaHeader.match(/Chrome\/(\d+)/i);
    browser = `Chrome ${match ? match[1] : ''}`.trim();
  } else if (ua.includes('firefox')) {
    const match = uaHeader.match(/Firefox\/(\d+)/i);
    browser = `Firefox ${match ? match[1] : ''}`.trim();
  } else if (ua.includes('safari') && !ua.includes('chrome')) {
    const match = uaHeader.match(/Version\/(\d+)/i);
    browser = `Safari ${match ? match[1] : ''}`.trim();
  }

  let os = 'Outro';
  if (ua.includes('windows nt 10.0')) os = 'Windows 10/11';
  else if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('iphone')) os = 'iPhone';
  else if (ua.includes('ipad')) os = 'iPad';
  else if (ua.includes('macintosh') || ua.includes('mac os')) os = 'macOS';
  else if (ua.includes('linux')) os = 'Linux';

  return `${browser} (${os})`.substring(0, 60);
}

// Ler cookies da requisição
function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      const key = parts.shift().trim();
      const val = decodeURIComponent(parts.join('='));
      list[key] = val;
    });
  }
  return list;
}

// Obter ou validar UUID de dispositivo
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getDeviceId(req) {
  const cookies = parseCookies(req);
  if (cookies.usf_did && UUID_REGEX.test(cookies.usf_did)) {
    return cookies.usf_did;
  }
  const headerId = req.headers['x-device-id'];
  if (headerId && UUID_REGEX.test(headerId)) {
    return headerId;
  }
  if (req.body && req.body.dispositivo_id && UUID_REGEX.test(req.body.dispositivo_id)) {
    return req.body.dispositivo_id;
  }
  return null;
}

function setDeviceCookie(res, deviceId) {
  const maxAge = 400 * 24 * 60 * 60; // 400 dias
  // Cookie httpOnly + SameSite=Lax (appendSetCookie evita sobrescrever usf_sess)
  const secure = isProdEnv() ? '; Secure' : '';
  appendSetCookie(res, `usf_did=${deviceId}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`);
}

// Verifica se está dentro do horário de expediente (06:00 às 20:00 Recife | Seg-Sex, Mutirão ou Hora Extra)
const _mutiraoDispCache = { data: '', extraAteMs: 0, checkedAt: 0 };
async function isHorarioExpedienteRecife(pool) {
  const ts = Date.now();
  if (pool && ts - _mutiraoDispCache.checkedAt > 30000) {
    try {
      const r = await pool.query(
        `SELECT chave, valor FROM configuracoes WHERE chave IN ('mutirao_data_liberada', 'expediente_extra_ate')`
      );
      let mutiraoData = '';
      let extraAteMs = 0;
      for (const row of r.rows || []) {
        if (row.chave === 'mutirao_data_liberada') mutiraoData = row.valor || '';
        if (row.chave === 'expediente_extra_ate') {
          const parsed = row.valor ? Date.parse(row.valor) : 0;
          extraAteMs = Number.isFinite(parsed) ? parsed : 0;
        }
      }
      _mutiraoDispCache.data = mutiraoData;
      _mutiraoDispCache.extraAteMs = extraAteMs;
      _mutiraoDispCache.checkedAt = ts;
    } catch (_) {}
  }

  if (_mutiraoDispCache.extraAteMs && ts < _mutiraoDispCache.extraAteMs) {
    return true;
  }

  const now = new Date(ts);
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Recife',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
  const hour = parseInt(new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Recife', hour: '2-digit', hour12: false
  }).format(now), 10);
  if (hour < 6 || hour >= 20) return false;

  const midnight = new Date(dateStr + 'T00:00:00Z');
  const day = midnight.getUTCDay(); // 0=Dom, 6=Sab
  if (day >= 1 && day <= 5) return true;

  const DATAS_MUTIRAO = ['2026-09-26', '2026-11-07', '2026-04-11', '2026-11-14', '2026-04-18'];
  if (DATAS_MUTIRAO.includes(dateStr)) return true;

  if (_mutiraoDispCache.data === dateStr) return true;
  return false;
}

// Configurar rotas e middlewares de dispositivos
function setupDispositivos(app, pool, isValidAdminPass) {

  // Middleware para verificar se dispositivo está bloqueado ou sem nome (quando modo restrito ativo)
  app.use(async (req, res, next) => {
    if (isRotaIsentaBloqueioDispositivo(req.method, req.path)) {
      return next();
    }

    const sess = req.session || getSessionFromRequest(req);
    const adminHdr = req.headers['x-admin-password'] || req.headers['x-admin-pass'];
    const isAdminReq = Boolean((sess && sess.role === 'admin') || isValidAdminPass(adminHdr));
    const bloquearSemNome = await isBloqueioSemNomeAtivo(pool);

    const deviceId = getDeviceId(req);
    if (!deviceId) {
      const decisaoSemId = avaliarAcessoDispositivo({
        deviceId: null,
        dispositivo: null,
        bloquearSemNome,
        isAdmin: isAdminReq
      });
      if (!decisaoSemId.permitido) {
        return res.status(423).json({
          error: decisaoSemId.error,
          code: decisaoSemId.code,
          motivo: decisaoSemId.motivo,
          bloquear_sem_nome: bloquearSemNome
        });
      }
      return next();
    }

    // Checar cache
    const cached = deviceStatusCache.get(deviceId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      if (cached.ativo === false && !isAdminReq) {
        return res.status(423).json({
          id: deviceId,
          error: 'Dispositivo bloqueado pelo administrador. Acesso negado.',
          code: 'DEVICE_BLOCKED',
          motivo: 'bloqueado'
        });
      }
      const decisaoCache = avaliarAcessoDispositivo({
        deviceId,
        dispositivo: cached,
        bloquearSemNome,
        isAdmin: isAdminReq
      });
      if (!decisaoCache.permitido) {
        return res.status(423).json({
          id: deviceId,
          error: decisaoCache.error,
          code: decisaoCache.code,
          motivo: decisaoCache.motivo,
          bloquear_sem_nome: bloquearSemNome
        });
      }
      return next();
    }

    try {
      const q = await pool.query('SELECT ativo, nome FROM dispositivos WHERE id = $1', [deviceId]);
      const row = q.rows[0] || null;
      if (row) {
        deviceStatusCache.set(deviceId, {
          ativo: row.ativo,
          nome: row.nome || 'Sem nome',
          expiresAt: now + CACHE_TTL_MS
        });
      }
      const decisaoDb = avaliarAcessoDispositivo({
        deviceId,
        dispositivo: row,
        bloquearSemNome,
        isAdmin: isAdminReq
      });
      if (!decisaoDb.permitido) {
        return res.status(423).json({
          id: deviceId,
          error: decisaoDb.error,
          code: decisaoDb.code,
          motivo: decisaoDb.motivo,
          bloquear_sem_nome: bloquearSemNome
        });
      }
    } catch (e) {
      // Falhas não devem travar a requisição em caso de instabilidade
    }

    next();
  });

  // POST /api/dispositivos/heartbeat (a cada 30s pelo front)
  app.post('/api/dispositivos/heartbeat', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    const sess = req.session || getSessionFromRequest(req);
    const adminHdr = req.headers['x-admin-password'] || req.headers['x-admin-pass'];
    const isAdminReq = Boolean((sess && sess.role === 'admin') || isValidAdminPass(adminHdr));
    const bloquearSemNome = await isBloqueioSemNomeAtivo(pool);

    if (!(await isHorarioExpedienteRecife(pool))) {
      const existingId = getDeviceId(req);
      if (existingId) {
        try {
          const chk = await pool.query('SELECT id, nome, setor, ativo FROM dispositivos WHERE id = $1', [existingId]);
          if (chk.rows.length > 0) {
            const dev = chk.rows[0];
            const decisaoFora = avaliarAcessoDispositivo({
              deviceId: dev.id,
              dispositivo: dev,
              bloquearSemNome,
              isAdmin: isAdminReq
            });
            if (!decisaoFora.permitido) {
              const isBloqTotal = Boolean(dev.emergencia_bloqueada || dev.motivo_bloqueio === 'bloqueio_total_emergencia');
              return res.status(423).json({
                ok: false,
                id: dev.id,
                nome: dev.nome || 'Sem nome',
                setor: dev.setor || '',
                ativo: dev.ativo,
                status: isBloqTotal ? 'bloqueio_total_emergencia' : decisaoFora.motivo,
                motivo: isBloqTotal ? 'bloqueio_total_emergencia' : decisaoFora.motivo,
                emergencia_bloqueada: isBloqTotal,
                motivo_bloqueio: dev.motivo_bloqueio || null,
                code: decisaoFora.code,
                error: decisaoFora.error,
                bloquear_sem_nome: bloquearSemNome
              });
            }
            return res.status(200).json({
              ok: true,
              status: 'fora_horario',
              msg: 'Fora do horário de heartbeat',
              id: dev.id,
              nome: dev.nome || 'Sem nome',
              setor: dev.setor || '',
              ativo: dev.ativo,
              emergencia_bloqueada: Boolean(dev.emergencia_bloqueada),
              motivo_bloqueio: dev.motivo_bloqueio || null,
              bloquear_sem_nome: bloquearSemNome
            });
          }
        } catch (_) {}
      }
      return res.status(200).json({
        ok: true,
        status: 'fora_horario',
        msg: 'Fora do horário de heartbeat',
        bloquear_sem_nome: bloquearSemNome
      });
    }

    try {
      let deviceId = getDeviceId(req);
      let isNew = false;

      if (!deviceId) {
        deviceId = crypto.randomUUID();
        isNew = true;
      }

      setDeviceCookie(res, deviceId);

      const ip = getClientIp(req);
      const ua = parseUserAgent(req.headers['user-agent']);

      // Buscar no banco
      const existing = await pool.query('SELECT * FROM dispositivos WHERE id = $1', [deviceId]);
      let dispositivo;

      if (existing.rows.length === 0) {
        const ins = await pool.query(
          `INSERT INTO dispositivos (id, nome, setor, ultimo_ip, user_agent, primeiro_acesso, ultimo_acesso, ativo)
           VALUES ($1, 'Sem nome', NULL, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, true)
           RETURNING *`,
          [deviceId, ip, ua]
        );
        dispositivo = ins.rows[0];
        isNew = true;

        // Registrar primeiro acesso
        await pool.query(
          `INSERT INTO dispositivo_acessos (dispositivo_id, ip, user_agent, tipo)
           VALUES ($1, $2, $3, 'primeiro_acesso')`,
          [deviceId, ip, ua]
        );
      } else {
        dispositivo = existing.rows[0];

        // Atualizar último acesso, IP e UA
        await pool.query(
          `UPDATE dispositivos 
           SET ultimo_ip = $2, user_agent = $3, ultimo_acesso = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [deviceId, ip, ua]
        );

        // Registrar primeiro acesso do dia se ainda não registrado hoje
        const hojeAcesso = await pool.query(
          `SELECT id FROM dispositivo_acessos
           WHERE dispositivo_id = $1 
             AND DATE(criado_em AT TIME ZONE 'America/Recife') = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Recife')::date
           LIMIT 1`,
          [deviceId]
        );

        if (hojeAcesso.rows.length === 0) {
          await pool.query(
            `INSERT INTO dispositivo_acessos (dispositivo_id, ip, user_agent, tipo)
             VALUES ($1, $2, $3, 'primeiro_acesso_dia')`,
            [deviceId, ip, ua]
          );
        }
      }

      deviceStatusCache.set(deviceId, {
        ativo: dispositivo.ativo,
        nome: dispositivo.nome || 'Sem nome',
        expiresAt: Date.now() + CACHE_TTL_MS
      });

      const decisao = avaliarAcessoDispositivo({
        deviceId,
        dispositivo,
        bloquearSemNome,
        isAdmin: isAdminReq
      });

      if (!decisao.permitido) {
        const isBloqTotal = Boolean(dispositivo.emergencia_bloqueada || dispositivo.motivo_bloqueio === 'bloqueio_total_emergencia');
        return res.status(423).json({
          ok: false,
          id: dispositivo.id,
          nome: dispositivo.nome || 'Sem nome',
          setor: dispositivo.setor || '',
          ativo: dispositivo.ativo,
          status: isBloqTotal ? 'bloqueio_total_emergencia' : decisao.motivo,
          motivo: isBloqTotal ? 'bloqueio_total_emergencia' : decisao.motivo,
          emergencia_bloqueada: isBloqTotal,
          motivo_bloqueio: dispositivo.motivo_bloqueio || null,
          code: decisao.code,
          error: decisao.error,
          bloquear_sem_nome: bloquearSemNome
        });
      }

      res.json({
        ok: true,
        id: dispositivo.id,
        nome: dispositivo.nome || 'Sem nome',
        setor: dispositivo.setor || '',
        ativo: dispositivo.ativo,
        isNew,
        emergencia_bloqueada: Boolean(dispositivo.emergencia_bloqueada),
        motivo_bloqueio: dispositivo.motivo_bloqueio || null,
        bloquear_sem_nome: bloquearSemNome
      });
    } catch (err) {
      console.error('Erro no heartbeat de dispositivos:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/dispositivos/acesso (Registra evento de login / liberação de gate)
  app.post('/api/dispositivos/acesso', async (req, res) => {
    try {
      await garantirColunasTentativasDispositivos(pool);
      let deviceId = getDeviceId(req);
      if (!deviceId) {
        deviceId = crypto.randomUUID();
        setDeviceCookie(res, deviceId);
      }
      const ip = getClientIp(req);
      const ua = parseUserAgent(req.headers['user-agent']);

      // Garantir existência do dispositivo e retornar dados cadastrados (nome/setor/ativo)
      const devUpsert = await pool.query(
        `INSERT INTO dispositivos (id, nome, setor, ultimo_ip, user_agent, primeiro_acesso, ultimo_acesso, ativo)
         VALUES ($1, 'Sem nome', NULL, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, true)
         ON CONFLICT (id) DO UPDATE SET ultimo_ip = $2, user_agent = $3, ultimo_acesso = CURRENT_TIMESTAMP
         RETURNING id, nome, setor, ativo, motivo_bloqueio, COALESCE(emergencia_bloqueada, false) AS emergencia_bloqueada`,
        [deviceId, ip, ua]
      );

      // Inserir registro de login
      await pool.query(
        `INSERT INTO dispositivo_acessos (dispositivo_id, ip, user_agent, tipo)
         VALUES ($1, $2, $3, 'login')`,
        [deviceId, ip, ua]
      );

      const dev = devUpsert.rows[0] || {};
      deviceStatusCache.set(deviceId, {
        ativo: dev.ativo !== false,
        nome: dev.nome || 'Sem nome',
        expiresAt: Date.now() + CACHE_TTL_MS
      });

      const sess = req.session || getSessionFromRequest(req);
      const adminHdr = req.headers['x-admin-password'] || req.headers['x-admin-pass'];
      const isAdminReq = Boolean((sess && sess.role === 'admin') || isValidAdminPass(adminHdr));
      const bloquearSemNome = await isBloqueioSemNomeAtivo(pool);
      const decisao = avaliarAcessoDispositivo({
        deviceId,
        dispositivo: dev,
        bloquearSemNome,
        isAdmin: isAdminReq
      });

      const isBloqTotal = Boolean(dev.emergencia_bloqueada || dev.motivo_bloqueio === 'bloqueio_total_emergencia');
      res.json({
        ok: true,
        deviceId,
        id: dev.id || deviceId,
        nome: dev.nome || 'Sem nome',
        setor: dev.setor || '',
        ativo: dev.ativo !== false,
        emergencia_bloqueada: isBloqTotal,
        motivo_bloqueio: dev.motivo_bloqueio || null,
        bloquear_sem_nome: bloquearSemNome,
        bloqueado_sem_nome: !decisao.permitido && decisao.motivo === 'sem_nome',
        motivo: isBloqTotal ? 'bloqueio_total_emergencia' : (decisao.permitido ? (dev.ativo === false ? (dev.motivo_bloqueio || 'bloqueado') : null) : decisao.motivo),
        code: decisao.permitido ? null : decisao.code
      });
    } catch (err) {
      console.error('Erro ao registrar acesso do dispositivo:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/dispositivos (Listar dispositivos para o Painel Admin)
  app.get('/api/admin/dispositivos', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    const isAdminSess = Boolean(req.session && req.session.role === 'admin');
    const senha = req.headers['x-admin-password'] || req.headers['x-admin-pass'];
    if (!isAdminSess && !isValidAdminPass(senha)) {
      return res.status(403).json({ error: 'Senha de administrador inválida' });
    }

    try {
      const { setor, status } = req.query;
      let query = `
        SELECT id, nome, setor, ultimo_ip, user_agent, primeiro_acesso, ultimo_acesso, ativo,
          CASE 
            WHEN ultimo_acesso >= (CURRENT_TIMESTAMP - INTERVAL '2 minutes') THEN true 
            ELSE false 
          END as online
        FROM dispositivos
        WHERE 1=1
      `;
      const params = [];
      let idx = 1;

      if (setor) {
        query += ` AND setor = $${idx}`;
        params.push(setor);
        idx++;
      }

      if (status === 'online') {
        query += ` AND ultimo_acesso >= (CURRENT_TIMESTAMP - INTERVAL '2 minutes')`;
      } else if (status === 'offline') {
        query += ` AND (ultimo_acesso < (CURRENT_TIMESTAMP - INTERVAL '2 minutes') OR ultimo_acesso IS NULL)`;
      } else if (status === 'bloqueado') {
        query += ` AND ativo = false`;
      } else if (status === 'sem_nome') {
        query += ` AND (nome IS NULL OR TRIM(nome) = '' OR LOWER(TRIM(nome)) = 'sem nome')`;
      } else if (status === 'com_nome') {
        query += ` AND nome IS NOT NULL AND TRIM(nome) <> '' AND LOWER(TRIM(nome)) <> 'sem nome'`;
      }

      query += ` ORDER BY ultimo_acesso DESC NULLS LAST`;

      const [result, resumoRes, bloquearSemNome] = await Promise.all([
        pool.query(query, params),
        pool.query(`
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE ultimo_acesso >= (CURRENT_TIMESTAMP - INTERVAL '2 minutes'))::int AS online,
            COUNT(*) FILTER (WHERE nome IS NOT NULL AND TRIM(nome) <> '' AND LOWER(TRIM(nome)) <> 'sem nome')::int AS com_nome,
            COUNT(*) FILTER (WHERE nome IS NULL OR TRIM(nome) = '' OR LOWER(TRIM(nome)) = 'sem nome')::int AS sem_nome,
            COUNT(*) FILTER (WHERE ativo = false)::int AS bloqueados
          FROM dispositivos
        `),
        isBloqueioSemNomeAtivo(pool, true)
      ]);

      // Identificar anomalias / alertas
      const dentroHorario = await isHorarioExpedienteRecife(pool);
      const rows = result.rows.map(d => {
        return {
          ...d,
          sem_nome: !isNomeDispositivoValido(d.nome),
          online_fora_horario: d.online && !dentroHorario
        };
      });

      const resumo = resumoRes.rows[0] || {
        total: rows.length,
        online: rows.filter(r => r.online).length,
        com_nome: rows.filter(r => !r.sem_nome).length,
        sem_nome: rows.filter(r => r.sem_nome).length,
        bloqueados: rows.filter(r => r.ativo === false).length
      };
      const totalOnlineForaHorario = rows.filter(r => r.online_fora_horario).length;

      res.json({
        dispositivos: rows,
        resumo,
        config: {
          bloquear_sem_nome: bloquearSemNome
        },
        alertas: {
          aparelhos_sem_nome: resumo.sem_nome,
          online_fora_horario: totalOnlineForaHorario
        }
      });
    } catch (err) {
      console.error('Erro ao listar dispositivos:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/admin/dispositivos/:id (Renomear / Mudar Setor / Bloquear)
  app.put('/api/admin/dispositivos/:id', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    const isAdminSess = Boolean(req.session && req.session.role === 'admin');
    const { senha: bodySenha, nome, setor, ativo } = req.body || {};
    const senha = bodySenha || req.headers['x-admin-password'] || req.headers['x-admin-pass'];
    if (!isAdminSess && !isValidAdminPass(senha)) {
      return res.status(403).json({ error: 'Senha de administrador inválida' });
    }

    const { id } = req.params;
    if (!id || String(id).trim().length < 4) {
      return res.status(400).json({ error: 'ID do dispositivo inválido' });
    }

    try {
      await garantirColunasTentativasDispositivos(pool);
      const updates = [];
      const params = [id];
      let idx = 2;

      if (typeof nome === 'string') {
        updates.push(`nome = $${idx}`);
        params.push(nome.trim() || 'Sem nome');
        idx++;
      }
      if (typeof setor === 'string') {
        updates.push(`setor = $${idx}`);
        params.push(setor.trim() || null);
        idx++;
      }
      if (ativo !== undefined && ativo !== null) {
        const ativoBool = ativo === true || ativo === 'true' || ativo === 1 || ativo === '1';
        updates.push(`ativo = $${idx}`);
        params.push(ativoBool);
        idx++;
        if (ativoBool) {
          updates.push('tentativas_falhas = 0');
          updates.push('bloqueio_etapa = 0');
          updates.push('bloqueio_temporario_ate = NULL');
          updates.push('tentativas_emergencia = 0');
          updates.push('emergencia_bloqueada = false');
          updates.push('motivo_bloqueio = NULL');
        } else {
          updates.push(`motivo_bloqueio = 'bloqueado_admin'`);
        }
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'Nenhum campo fornecido para atualização' });
      }

      const q = await pool.query(
        `UPDATE dispositivos SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
        params
      );

      if (q.rows.length === 0) {
        return res.status(404).json({ error: 'Dispositivo não encontrado' });
      }

      // Atualizar cache imediatamente
      const updated = q.rows[0];
      deviceStatusCache.set(id, {
        ativo: updated.ativo,
        nome: updated.nome || 'Sem nome',
        expiresAt: Date.now() + CACHE_TTL_MS
      });

      res.json({ ok: true, dispositivo: updated });
    } catch (err) {
      console.error('Erro ao atualizar dispositivo:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/dispositivos/config-bloqueio-sem-nome (Chave global: bloquear dispositivos sem nome)
  app.post('/api/admin/dispositivos/config-bloqueio-sem-nome', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    const isAdminSess = Boolean(req.session && req.session.role === 'admin');
    const senha = req.body?.senha || req.headers['x-admin-password'] || req.headers['x-admin-pass'];
    if (!isAdminSess && !isValidAdminPass(senha)) {
      return res.status(403).json({ error: 'Senha de administrador inválida' });
    }

    const habilitar =
      req.body?.bloquear_sem_nome === true ||
      req.body?.bloquear_sem_nome === 'true' ||
      req.body?.bloquear_sem_nome === 1 ||
      req.body?.bloquear_sem_nome === '1';

    try {
      if (habilitar) {
        // Trava anti-autobloqueio 1: se o aparelho do Admin está identificado por ID, precisa estar cadastrado com nome e ativo
        const reqDeviceId = getDeviceId(req);
        if (reqDeviceId) {
          const selfRes = await pool.query(
            'SELECT nome, ativo FROM dispositivos WHERE id = $1 LIMIT 1',
            [reqDeviceId]
          );
          const selfRow = selfRes.rows[0];
          if (!selfRow || selfRow.ativo === false || !isNomeDispositivoValido(selfRow.nome)) {
            return res.status(400).json({
              error: 'Antes de ativar o bloqueio, dê um nome ao aparelho que você está usando agora (ESTE APARELHO).',
              code: 'ADMIN_DEVICE_UNNAMED'
            });
          }
        }

        // Trava anti-autobloqueio 2: garantir que existe ao menos 1 aparelho ativo nomeado na unidade
        const countRes = await pool.query(`
          SELECT COUNT(*)::int AS total
          FROM dispositivos
          WHERE ativo IS DISTINCT FROM false
            AND nome IS NOT NULL
            AND TRIM(nome) <> ''
            AND LOWER(TRIM(nome)) <> 'sem nome'
        `);
        const totalNomeados = Number(countRes.rows[0]?.total || 0);
        if (totalNomeados <= 0) {
          return res.status(400).json({
            error: 'Cadastre o nome de pelo menos um dispositivo antes de ativar o bloqueio.',
            code: 'NO_NAMED_DEVICES'
          });
        }
      }

      await pool.query(
        `INSERT INTO configuracoes (chave, valor)
         VALUES ($1, $2)
         ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
        [CONFIG_CHAVE_BLOQUEIO_SEM_NOME, habilitar ? 'true' : 'false']
      );

      setBloqueioSemNomeCache(habilitar);
      deviceStatusCache.clear();

      res.json({ ok: true, bloquear_sem_nome: habilitar });
    } catch (err) {
      console.error('Erro ao salvar configuração de bloqueio sem nome:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/dispositivos/:id/acessos (Histórico de logins dos últimos 30 dias)
  app.get('/api/admin/dispositivos/:id/acessos', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    const isAdminSess = Boolean(req.session && req.session.role === 'admin');
    const senha = req.headers['x-admin-password'] || req.headers['x-admin-pass'];
    if (!isAdminSess && !isValidAdminPass(senha)) {
      return res.status(403).json({ error: 'Senha de administrador inválida' });
    }

    const { id } = req.params;
    try {
      const result = await pool.query(
        `SELECT id, ip, user_agent, tipo, criado_em
         FROM dispositivo_acessos
         WHERE dispositivo_id = $1
           AND criado_em >= (CURRENT_TIMESTAMP - INTERVAL '30 days')
         ORDER BY criado_em DESC
         LIMIT 100`,
        [id]
      );
      res.json(result.rows);
    } catch (err) {
      console.error('Erro ao buscar histórico de acessos:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/admin/dispositivos/:id (Excluir dispositivo e seus logs)
  app.delete('/api/admin/dispositivos/:id', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    const isAdminSess = Boolean(req.session && req.session.role === 'admin');
    const senha = req.headers['x-admin-password'] || req.headers['x-admin-pass'] || req.body?.senha;
    if (!isAdminSess && !isValidAdminPass(senha)) {
      return res.status(403).json({ error: 'Senha de administrador inválida' });
    }
    const { id } = req.params;
    try {
      await pool.query('DELETE FROM dispositivo_acessos WHERE dispositivo_id = $1', [id]);
      const del = await pool.query('DELETE FROM dispositivos WHERE id = $1 RETURNING id', [id]);
      if (del.rows.length === 0) {
        return res.status(404).json({ error: 'Dispositivo não encontrado' });
      }
      deviceStatusCache.delete(id);
      res.json({ ok: true, id });
    } catch (err) {
      console.error('Erro ao excluir dispositivo:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/dispositivos/limpar-antigos (Remove offline há +30 dias)
  app.post('/api/admin/dispositivos/limpar-antigos', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    const isAdminSess = Boolean(req.session && req.session.role === 'admin');
    const senha = req.headers['x-admin-password'] || req.headers['x-admin-pass'] || req.body?.senha;
    if (!isAdminSess && !isValidAdminPass(senha)) {
      return res.status(403).json({ error: 'Senha de administrador inválida' });
    }
    try {
      const antigos = await pool.query(
        `SELECT id FROM dispositivos WHERE ultimo_acesso < (CURRENT_TIMESTAMP - INTERVAL '30 days')`
      );
      const ids = antigos.rows.map(r => r.id);
      if (ids.length > 0) {
        await pool.query('DELETE FROM dispositivo_acessos WHERE dispositivo_id = ANY($1::uuid[])', [ids]);
        await pool.query('DELETE FROM dispositivos WHERE id = ANY($1::uuid[])', [ids]);
        ids.forEach(id => deviceStatusCache.delete(id));
      }
      res.json({ ok: true, removidos: ids.length });
    } catch (err) {
      console.error('Erro ao limpar dispositivos antigos:', err.message);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = {
  setupDispositivos,
  getDeviceId,
  getClientIp,
  parseUserAgent,
  setDeviceCookie,
  CONFIG_CHAVE_BLOQUEIO_SEM_NOME,
  MAX_TENTATIVAS_ANTES_BLOQUEIO,
  MAX_TENTATIVAS_EMERGENCIA,
  DURACAO_BLOQUEIO_TEMP_MS,
  calcularEstadoBloqueioAtual,
  calcularProximoEstadoFalha,
  calcularProximoEstadoFalhaEmergencia,
  garantirColunasTentativasDispositivos,
  consultarEstadoBloqueioDispositivo,
  registrarFalhaAuthDispositivo,
  registrarFalhaEmergenciaDispositivo,
  resetarTentativasAuthDispositivo,
  isNomeDispositivoValido,
  isRotaIsentaBloqueioDispositivo,
  avaliarAcessoDispositivo,
  isBloqueioSemNomeAtivo,
  setBloqueioSemNomeCache
};
