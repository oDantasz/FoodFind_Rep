// Segurança: senhas, sessões, cookies, limite de tentativas, cabeçalhos e origem.
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const KEYLEN = 64;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(String(password), salt, KEYLEN)).toString('hex');
  return `${salt}:${hash}`;
}

// Hash fixo usado quando o e-mail não existe, para que o tempo de resposta
// do login não revele se a conta existe.
const DUMMY_HASH = `${'0'.repeat(32)}:${'0'.repeat(128)}`;

async function checkPassword(password, stored) {
  const [salt, hash] = String(stored || DUMMY_HASH).split(':');
  if (!salt || !hash || !/^[a-f0-9]+$/i.test(hash)) return false;
  const test = await scrypt(String(password), salt, KEYLEN);
  const original = Buffer.from(hash, 'hex');
  const ok = original.length === test.length && crypto.timingSafeEqual(original, test);
  return ok && Boolean(stored) && stored !== DUMMY_HASH;
}

function newToken() { return crypto.randomBytes(32).toString('base64url'); }
function hashToken(token) { return crypto.createHash('sha256').update(String(token)).digest('hex'); }

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = ''; }
  }
  return out;
}

function trustProxy() { return process.env.TRUST_PROXY === '1'; }

// HTTPS direto ou atrás de proxy reverso que informa X-Forwarded-Proto.
function isHttps(req) {
  return Boolean(req.socket && req.socket.encrypted) || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function sessionCookie(req, token, maxAgeSeconds) {
  return `ff_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${isHttps(req) ? '; Secure' : ''}`;
}

function clientIp(req) {
  if (trustProxy()) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress || 'desconhecido';
}

// Limitador simples em memória (janela fixa por chave).
class RateLimiter {
  constructor({ max, windowMs, blockMs }) {
    this.max = max;
    this.windowMs = windowMs;
    this.blockMs = blockMs || windowMs;
    this.hits = new Map();
  }

  entry(key) {
    const now = Date.now();
    let e = this.hits.get(key);
    if (!e || (now > e.reset && (!e.blockedUntil || now > e.blockedUntil))) {
      e = { count: 0, reset: now + this.windowMs, blockedUntil: 0 };
      this.hits.set(key, e);
    }
    return e;
  }

  // Segundos até liberar, ou 0 se não estiver bloqueado.
  retryAfter(key) {
    const e = this.hits.get(key);
    if (!e || !e.blockedUntil) return 0;
    const left = e.blockedUntil - Date.now();
    return left > 0 ? Math.ceil(left / 1000) : 0;
  }

  hit(key) {
    const e = this.entry(key);
    e.count += 1;
    if (e.count >= this.max && !e.blockedUntil) e.blockedUntil = Date.now() + this.blockMs;
    return this.retryAfter(key);
  }

  // Conta uma tentativa e informa se ultrapassou o limite (para limites de uso, não de falha).
  consume(key) {
    const e = this.entry(key);
    if (e.blockedUntil && Date.now() < e.blockedUntil) return this.retryAfter(key);
    e.count += 1;
    if (e.count > this.max) {
      e.blockedUntil = Date.now() + this.blockMs;
      return this.retryAfter(key);
    }
    return 0;
  }

  reset(key) { this.hits.delete(key); }

  sweep() {
    const now = Date.now();
    for (const [k, e] of this.hits) if (now > e.reset && (!e.blockedUntil || now > e.blockedUntil)) this.hits.delete(k);
  }
}

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

const MIN = 60 * 1000;
const limits = {
  // Falhas de login por e-mail: 5 em 15 min bloqueiam o e-mail por 15 min.
  loginEmail: new RateLimiter({ max: envInt('FOODFIND_LOGIN_MAX_PER_EMAIL', 5), windowMs: 15 * MIN, blockMs: 15 * MIN }),
  // Tentativas de login por IP: 20 em 15 min.
  loginIp: new RateLimiter({ max: envInt('FOODFIND_LOGIN_MAX_PER_IP', 20), windowMs: 15 * MIN, blockMs: 15 * MIN }),
  // Cadastros por IP: 10 por hora; por e-mail: 5 por hora.
  registerIp: new RateLimiter({ max: envInt('FOODFIND_REGISTER_MAX_PER_IP', 10), windowMs: 60 * MIN, blockMs: 60 * MIN }),
  registerEmail: new RateLimiter({ max: 5, windowMs: 60 * MIN, blockMs: 60 * MIN }),
  // Códigos de campanha inválidos por usuário: 10 em 15 min.
  redeem: new RateLimiter({ max: envInt('FOODFIND_REDEEM_MAX_FAILS', 10), windowMs: 15 * MIN, blockMs: 15 * MIN }),
  geocode: new RateLimiter({ max: envInt('FOODFIND_GEOCODE_MAX_PER_MIN', 30), windowMs: MIN, blockMs: MIN }),
  tiles: new RateLimiter({ max: envInt('FOODFIND_TILES_MAX_PER_MIN', 600), windowMs: MIN, blockMs: MIN }),
  search: new RateLimiter({ max: envInt('FOODFIND_SEARCH_MAX_PER_MIN', 60), windowMs: MIN, blockMs: MIN })
};

function minutesText(seconds) {
  const m = Math.max(1, Math.ceil(seconds / 60));
  return m === 1 ? '1 minuto' : `${m} minutos`;
}

const TILE_HOSTS = 'https://tile.openstreetmap.org https://server.arcgisonline.com';
const CDN = 'https://unpkg.com';

const CSP = [
  "default-src 'self'",
  `script-src 'self' ${CDN}`,
  `style-src 'self' ${CDN}`,
  `img-src 'self' data: blob: ${CDN} ${TILE_HOSTS}`,
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

function securityHeaders(req, res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=(), payment=(), usb=(), interest-cohort=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
}

function hostOf(value) {
  try { return new URL(value).host.toLowerCase(); } catch { return ''; }
}

function allowedHosts(req) {
  const hosts = new Set([String(req.headers.host || '').toLowerCase()]);
  if (process.env.PUBLIC_URL) hosts.add(hostOf(process.env.PUBLIC_URL));
  if (trustProxy() && req.headers['x-forwarded-host']) hosts.add(String(req.headers['x-forwarded-host']).split(',')[0].trim().toLowerCase());
  hosts.delete('');
  return hosts;
}

// A requisição veio de uma página do próprio site?
// Usa Sec-Fetch-Site (navegadores atuais); sem ele, compara Origin ou Referer.
function isSameSite(req) {
  const site = req.headers['sec-fetch-site'];
  if (site) return site === 'same-origin';
  const hosts = allowedHosts(req);
  if (req.headers.origin) return hosts.has(hostOf(req.headers.origin));
  if (req.headers.referer) return hosts.has(hostOf(req.headers.referer));
  return false;
}

// Para POST/PUT/DELETE: se o navegador informar a origem, ela precisa ser o próprio site.
function isForeignOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return true;
  if (req.headers.origin && req.headers.origin !== 'null') return !allowedHosts(req).has(hostOf(req.headers.origin));
  return req.headers.origin === 'null';
}

// Registro de erros sem dados sensíveis.
const SENSITIVE = /(password|senha|token|cookie|authorization|code|codigo|secret)/i;
function redact(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SENSITIVE.test(k) ? '[oculto]' : redact(v)]));
}

function logError(context, err) {
  const e = err instanceof Error ? err : new Error(String(err));
  const msg = String(e.message || '').replace(/ff_session=[^;\s]+/g, 'ff_session=[oculto]');
  console.error(`[${new Date().toISOString()}] ${context}: ${e.name}: ${msg}${e.stack && process.env.NODE_ENV !== 'production' ? `\n${e.stack.split('\n').slice(1, 6).join('\n')}` : ''}`);
}

module.exports = {
  hashPassword, checkPassword, newToken, hashToken, parseCookies, sessionCookie, isHttps, clientIp,
  RateLimiter, limits, minutesText, securityHeaders, isSameSite, isForeignOrigin, redact, logError, CSP
};
