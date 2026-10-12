// @ts-nocheck
const crypto = require('crypto');

// Cache em memória de status dos dispositivos (60 segundos de TTL para economizar banco no Neon/Vercel)
const deviceStatusCache = new Map();
const CACHE_TTL_MS = 60000;

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
  // Cookie httpOnly + SameSite=Lax
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `usf_did=${deviceId}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`);
}

// Verifica se está dentro do horário de expediente (06:00 às 18:00 Recife)
function isHorarioExpedienteRecife() {
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Recife',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
  const hour = parseInt(new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Recife', hour: '2-digit', hour12: false
  }).format(now), 10);
  const midnight = new Date(dateStr + 'T00:00:00Z');
  const day = midnight.getUTCDay(); // 0=Dom, 6=Sab

  // Sábados e Domingos são fora de expediente
  if (day === 0 || day === 6) return false;
  return (hour >= 6 && hour < 18);
}

// Configurar rotas e middlewares de dispositivos
function setupDispositivos(app, pool, isValidAdminPass) {

  // Middleware para verificar se dispositivo está bloqueado
  app.use(async (req, res, next) => {
    // Permitir endpoints públicos, de autenticação ou de assets
    if (!req.path.startsWith('/api') || 
        req.path === '/api/verify-admin' || 
        req.path === '/api/dispositivos/heartbeat' || 
        req.path.startsWith('/api/admin/')) {
      return next();
    }

    const deviceId = getDeviceId(req);
    if (!deviceId) return next();

    // Checar cache
    const cached = deviceStatusCache.get(deviceId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      if (cached.ativo === false) {
        return res.status(423).json({ error: 'Dispositivo bloqueado pelo administrador. Acesso negado.' });
      }
      return next();
    }

    try {
      const q = await pool.query('SELECT ativo FROM dispositivos WHERE id = $1', [deviceId]);
      if (q.rows.length > 0) {
        const ativo = q.rows[0].ativo;
        deviceStatusCache.set(deviceId, { ativo, expiresAt: now + CACHE_TTL_MS });
        if (!ativo) {
          return res.status(423).json({ error: 'Dispositivo bloqueado pelo administrador. Acesso negado.' });
        }
      }
    } catch (e) {
      // Falhas não devem travar a requisição em caso de instabilidade
    }

    next();
  });

  // POST /api/dispositivos/heartbeat (a cada 60s pelo front, entre 06h e 18h)
  app.post('/api/dispositivos/heartbeat', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');

    if (!isHorarioExpedienteRecife()) {
      return res.status(200).json({ ok: true, status: 'fora_horario', msg: 'Fora do horário de heartbeat' });
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

      deviceStatusCache.set(deviceId, { ativo: dispositivo.ativo, expiresAt: Date.now() + CACHE_TTL_MS });

      res.json({
        ok: true,
        id: dispositivo.id,
        nome: dispositivo.nome || 'Sem nome',
        setor: dispositivo.setor || '',
        ativo: dispositivo.ativo,
        isNew
      });
    } catch (err) {
      console.error('Erro no heartbeat de dispositivos:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/dispositivos/acesso (Registra evento de login / liberação de gate)
  app.post('/api/dispositivos/acesso', async (req, res) => {
    try {
      let deviceId = getDeviceId(req);
      if (!deviceId) {
        deviceId = crypto.randomUUID();
        setDeviceCookie(res, deviceId);
      }
      const ip = getClientIp(req);
      const ua = parseUserAgent(req.headers['user-agent']);

      // Garantir existência do dispositivo
      await pool.query(
        `INSERT INTO dispositivos (id, nome, setor, ultimo_ip, user_agent, primeiro_acesso, ultimo_acesso, ativo)
         VALUES ($1, 'Sem nome', NULL, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, true)
         ON CONFLICT (id) DO UPDATE SET ultimo_ip = $2, user_agent = $3, ultimo_acesso = CURRENT_TIMESTAMP`,
        [deviceId, ip, ua]
      );

      // Inserir registro de login
      await pool.query(
        `INSERT INTO dispositivo_acessos (dispositivo_id, ip, user_agent, tipo)
         VALUES ($1, $2, $3, 'login')`,
        [deviceId, ip, ua]
      );

      res.json({ ok: true, deviceId });
    } catch (err) {
      console.error('Erro ao registrar acesso do dispositivo:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/dispositivos (Listar dispositivos para o Painel Admin)
  app.get('/api/admin/dispositivos', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    const senha = req.headers['x-admin-password'] || req.headers['x-admin-pass'] || req.query.senha;
    if (!isValidAdminPass(senha)) {
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
      }

      query += ` ORDER BY ultimo_acesso DESC NULLS LAST`;

      const result = await pool.query(query, params);

      // Identificar anomalias / alertas
      const dentroHorario = isHorarioExpedienteRecife();
      const rows = result.rows.map(d => {
        return {
          ...d,
          sem_nome: !d.nome || d.nome === 'Sem nome',
          online_fora_horario: d.online && !dentroHorario
        };
      });

      const totalSemNome = rows.filter(r => r.sem_nome).length;
      const totalOnlineForaHorario = rows.filter(r => r.online_fora_horario).length;

      res.json({
        dispositivos: rows,
        alertas: {
          aparelhos_sem_nome: totalSemNome,
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
    const { senha: bodySenha, nome, setor, ativo } = req.body || {};
    const senha = bodySenha || req.headers['x-admin-password'] || req.headers['x-admin-pass'] || req.query.senha;
    if (!isValidAdminPass(senha)) {
      return res.status(403).json({ error: 'Senha de administrador inválida' });
    }

    const { id } = req.params;
    if (!UUID_REGEX.test(id)) {
      return res.status(400).json({ error: 'ID do dispositivo inválido' });
    }

    try {
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
      if (typeof ativo === 'boolean') {
        updates.push(`ativo = $${idx}`);
        params.push(ativo);
        idx++;
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
      deviceStatusCache.set(id, { ativo: updated.ativo, expiresAt: Date.now() + CACHE_TTL_MS });

      res.json({ ok: true, dispositivo: updated });
    } catch (err) {
      console.error('Erro ao atualizar dispositivo:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/dispositivos/:id/acessos (Histórico de logins dos últimos 30 dias)
  app.get('/api/admin/dispositivos/:id/acessos', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    const senha = req.headers['x-admin-password'] || req.headers['x-admin-pass'] || req.query.senha;
    if (!isValidAdminPass(senha)) {
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
}

module.exports = {
  setupDispositivos,
  getDeviceId,
  getClientIp,
  parseUserAgent,
  setDeviceCookie
};
