// @ts-nocheck
const crypto = require('crypto');

const SESSION_COOKIE_NAME = 'usf_sess';
const SESSION_TTL_MS = 10 * 60 * 60 * 1000; // 10 horas

const DEFAULT_GATE_HASH = 'af99a4ea5f59cb313edbcf21759afcbad8c77212870be1098363836e00e816c1';
const LEGACY_ADMIN_HASHES = [
  '3512f3ae578af092eab65ecdf7f2256741e63f406aea8e376c4dbf7ae84006e9',
  'e45221fa88c60d0fd12174acbfd8676dcaac08202319cd3888bfd611b12ed701',
  'af99a4ea5f59cb313edbcf21759afcbad8c77212870be1098363836e00e816c1'
];

let _ephemeralSessionSecret = null;
const _rateLimitStore = new Map();

function sha256Hex(str) {
  return crypto.createHash('sha256').update(String(str ?? ''), 'utf8').digest('hex');
}

function safeEqualStr(a, b) {
  const bufA = Buffer.from(sha256Hex(a), 'hex');
  const bufB = Buffer.from(sha256Hex(b), 'hex');
  return crypto.timingSafeEqual(bufA, bufB);
}

function safeEqualHex(hexA, hexB) {
  const normA = String(hexA || '').trim().toLowerCase();
  const normB = String(hexB || '').trim().toLowerCase();
  if (!normA || !normB) return false;
  return safeEqualStr(normA, normB);
}

function parseCookies(req) {
  const list = {};
  const rc = req && req.headers ? req.headers.cookie : '';
  if (!rc || typeof rc !== 'string') return list;

  rc.split(';').forEach(cookie => {
    const idx = cookie.indexOf('=');
    if (idx <= 0) return;
    const key = cookie.slice(0, idx).trim();
    const rawVal = cookie.slice(idx + 1).trim();
    if (!key) return;
    try {
      list[key] = decodeURIComponent(rawVal);
    } catch {
      list[key] = rawVal;
    }
  });
  return list;
}

function appendSetCookie(res, cookieStr) {
  if (!res || typeof res.setHeader !== 'function') return;
  const existing = typeof res.getHeader === 'function' ? res.getHeader('Set-Cookie') : undefined;
  if (!existing) {
    res.setHeader('Set-Cookie', cookieStr);
    return;
  }
  const list = Array.isArray(existing) ? existing.slice() : [String(existing)];
  const cookieName = String(cookieStr).split('=')[0];
  const filtered = list.filter(c => !String(c).startsWith(`${cookieName}=`));
  filtered.push(cookieStr);
  res.setHeader('Set-Cookie', filtered);
}

function isProdEnv() {
  return process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
}

function getSessionSecret() {
  const explicit = String(process.env.SESSION_SECRET || '').trim();
  if (explicit) return explicit;

  const seedParts = [
    process.env.DATABASE_URL,
    process.env.GEMINI_API_KEY,
    process.env.ADMIN_PASSWORDS,
    process.env.GATE_PASSWORD,
    process.env.GATE_HASH
  ].map(v => String(v || '').trim()).filter(Boolean);

  if (seedParts.length > 0) {
    return sha256Hex(`usf-cm-sess-v1|${seedParts.join('|')}`);
  }

  if (!_ephemeralSessionSecret) {
    _ephemeralSessionSecret = crypto.randomBytes(32).toString('hex');
  }
  return _ephemeralSessionSecret;
}

function createSessionToken(role = 'staff', ttlMs = SESSION_TTL_MS) {
  const now = Date.now();
  const payload = {
    v: 1,
    role: role === 'admin' ? 'admin' : 'staff',
    iat: now,
    exp: now + (Number(ttlMs) > 0 ? Number(ttlMs) : SESSION_TTL_MS)
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.trim().split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  const [payloadB64, providedSig] = parts;
  const expectedSig = crypto.createHmac('sha256', getSessionSecret()).update(payloadB64).digest('base64url');
  if (!safeEqualStr(providedSig, expectedSig)) return null;

  try {
    const rawJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const payload = JSON.parse(rawJson);
    if (!payload || payload.v !== 1) return null;
    if (typeof payload.exp !== 'number' || payload.exp <= Date.now()) return null;
    return {
      v: 1,
      role: payload.role === 'admin' ? 'admin' : 'staff',
      iat: payload.iat,
      exp: payload.exp
    };
  } catch {
    return null;
  }
}

function setSessionCookie(res, role = 'staff') {
  const token = createSessionToken(role, SESSION_TTL_MS);
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const secure = isProdEnv() ? '; Secure' : '';
  appendSetCookie(res, `${SESSION_COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`);
  return token;
}

function clearSessionCookie(res) {
  const secure = isProdEnv() ? '; Secure' : '';
  appendSetCookie(res, `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`);
}

function getSessionFromRequest(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
  return verifySessionToken(token);
}

function isValidGatePass(senha) {
  const s = String(senha || '').trim();
  if (!s) return false;

  const envPass = String(process.env.GATE_PASSWORD || '').trim();
  if (envPass) {
    const candidates = envPass.split(',').map(x => x.trim()).filter(Boolean);
    return candidates.some(cand => safeEqualStr(s, cand));
  }

  const envHashes = String(process.env.GATE_HASH || '').trim();
  const sHash = sha256Hex(s);
  if (envHashes) {
    const hashCandidates = envHashes.split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
    return hashCandidates.some(h => safeEqualHex(sHash, h));
  }

  return safeEqualHex(sHash, DEFAULT_GATE_HASH);
}

function isValidAdminPass(senha) {
  const s = String(senha || '').trim();
  if (!s) return false;

  const envAdmins = String(process.env.ADMIN_PASSWORDS || '').trim();
  if (envAdmins) {
    const candidates = envAdmins.split(',').map(x => x.trim()).filter(Boolean);
    return candidates.some(cand => safeEqualStr(s, cand));
  }

  const sHash = sha256Hex(s);
  return LEGACY_ADMIN_HASHES.some(h => safeEqualHex(sHash, h));
}

function isPublicApiRoute(method, reqPath) {
  const m = String(method || 'GET').toUpperCase();
  const p = String(reqPath || '/').split('?')[0].replace(/\/+$/, '') || '/';

  if (m === 'OPTIONS') return true;
  if (m === 'GET' && p === '/health') return true;
  if (m === 'POST' && (p === '/auth/login' || p === '/auth/logout' || p === '/verify-admin')) return true;
  if (m === 'GET' && p === '/auth/session') return true;
  if (m === 'GET' && (p === '/config/pausa' || p === '/config/mutirao-hoje' || p === '/config/jingle' || p === '/config-prioridade')) return true;
  if (m === 'GET' && (p === '/current-calling' || p === '/tv/history')) return true;
  if (m === 'GET' && p === '/voice-call/pending') return true;
  if (m === 'POST' && /^\/voice-call\/\d+\/ack$/.test(p)) return true;
  if ((m === 'GET' || m === 'POST') && p === '/tts') return true;
  if (m === 'GET' && /^\/patients\/\d+\/status$/.test(p)) return true;
  if (m === 'POST' && p === '/dispositivos/heartbeat') return true;
  if (m === 'GET' && p === '/cron/limpeza') return true;

  return false;
}

function getClientIp(req) {
  let ip = '';
  const forwarded = req && req.headers ? req.headers['x-forwarded-for'] : '';
  if (forwarded) {
    ip = String(forwarded).split(',')[0].trim();
  } else if (req && req.ip) {
    ip = String(req.ip).trim();
  } else if (req && req.socket && req.socket.remoteAddress) {
    ip = String(req.socket.remoteAddress).trim();
  }
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }
  return ip || 'unknown';
}

function _pruneRateLimitStore(now) {
  if (_rateLimitStore.size <= 2000) return;
  for (const [key, entry] of _rateLimitStore.entries()) {
    if (!entry || entry.resetAt <= now) {
      _rateLimitStore.delete(key);
    }
  }
}

function isRateLimited(bucket, ip, maxRequests, windowMs) {
  const now = Date.now();
  const key = `${bucket}:${ip || 'unknown'}`;
  const entry = _rateLimitStore.get(key);
  if (!entry || entry.resetAt <= now) {
    return { blocked: false, remaining: maxRequests, retryAfterSec: 0 };
  }
  const remaining = Math.max(0, maxRequests - entry.count);
  const blocked = entry.count >= maxRequests;
  const retryAfterSec = blocked ? Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) : 0;
  return { blocked, remaining, retryAfterSec };
}

function recordRateLimitHit(bucket, ip, windowMs) {
  const now = Date.now();
  _pruneRateLimitStore(now);
  const key = `${bucket}:${ip || 'unknown'}`;
  let entry = _rateLimitStore.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
  }
  entry.count += 1;
  _rateLimitStore.set(key, entry);
  return entry.count;
}

function resetRateLimit(bucket, ip) {
  const key = `${bucket}:${ip || 'unknown'}`;
  _rateLimitStore.delete(key);
}

function checkRateLimit(bucket, ip, maxRequests, windowMs) {
  const now = Date.now();
  _pruneRateLimitStore(now);
  const key = `${bucket}:${ip || 'unknown'}`;
  let entry = _rateLimitStore.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
  }
  if (entry.count >= maxRequests) {
    const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    _rateLimitStore.set(key, entry);
    return { allowed: false, remaining: 0, retryAfterSec };
  }
  entry.count += 1;
  _rateLimitStore.set(key, entry);
  return {
    allowed: true,
    remaining: Math.max(0, maxRequests - entry.count),
    retryAfterSec: 0
  };
}

function getAllowedOrigins() {
  const origins = new Set([
    'https://fila-usf-chico-mendes.vercel.app',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ]);
  const vercelUrl = String(process.env.VERCEL_URL || '').trim().replace(/^https?:\/\//i, '');
  if (vercelUrl) {
    origins.add(`https://${vercelUrl}`);
  }
  const extra = String(process.env.ALLOWED_ORIGINS || '').trim();
  if (extra) {
    extra.split(',').map(s => s.trim()).filter(Boolean).forEach(o => origins.add(o));
  }
  return origins;
}

function buildCorsOptions() {
  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      const allowed = getAllowedOrigins();
      if (allowed.has(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-password', 'x-device-id']
  };
}

function buildCspHeader() {
  const devConnect = isProdEnv() ? '' : ' http://localhost:3000 http://127.0.0.1:3000';
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob:",
    `connect-src 'self'${devConnect}`,
    "frame-src 'self' blob: data:",
    "object-src 'self' blob: data:",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'"
  ].join('; ');
}

function securityHeadersMiddleware(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(), microphone=(), payment=(), usb=()');
  res.setHeader('Content-Security-Policy', buildCspHeader());
  if (isProdEnv()) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

module.exports = {
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  DEFAULT_GATE_HASH,
  LEGACY_ADMIN_HASHES,
  sha256Hex,
  safeEqualStr,
  safeEqualHex,
  parseCookies,
  appendSetCookie,
  isProdEnv,
  getSessionSecret,
  createSessionToken,
  verifySessionToken,
  setSessionCookie,
  clearSessionCookie,
  getSessionFromRequest,
  isValidGatePass,
  isValidAdminPass,
  isPublicApiRoute,
  getClientIp,
  isRateLimited,
  recordRateLimitHit,
  resetRateLimit,
  checkRateLimit,
  getAllowedOrigins,
  buildCorsOptions,
  buildCspHeader,
  securityHeadersMiddleware
};
