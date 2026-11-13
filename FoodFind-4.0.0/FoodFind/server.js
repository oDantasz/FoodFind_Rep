// FoodFind: servidor HTTP (módulo http nativo, sem Express).
// Rotas da API em api(); arquivos estáticos em public/; banco SQLite em db.js.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const db = require('./db');
const pkg = require('./package.json');
const { send, httpError, readBody, sendFile } = require('./lib/http');
const {
  CATEGORIES, PRICE_RANGES, FIELDS, PHOTO_PATH, str, normalizeName, isEmail, cleanRestaurant
} = require('./lib/validate');
const sec = require('./lib/security');
const osm = require('./lib/osm');
const time = require('./lib/time');

const VERSION = pkg.version;
const PORT = process.env.PORT === undefined ? 3000 : Number(process.env.PORT);
const HOST = process.env.HOST || '0.0.0.0';
const root = path.join(__dirname, 'public');
const DEFAULT_LOCATION = { lat: -23.5613, lng: -46.6565 }; // Av. Paulista, São Paulo
const DEFAULT_RADIUS_KM = 4;
const MAX_RADIUS_KM = 10;
const SESSION_DAYS = 30;
const MAX_RESULTS = 300;
const REVIEW_MAX = 600;
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const IS_DEV = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');

// ----------------------------------------------------------------------------
// Utilidades gerais
// ----------------------------------------------------------------------------
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const p = Math.PI / 180;
  const a = 0.5 - Math.cos((lat2 - lat1) * p) / 2 + Math.cos(lat1 * p) * Math.cos(lat2 * p) * (1 - Math.cos((lon2 - lon1) * p)) / 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function formatDistance(km) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1).replace('.', ',')} km`;
}

// "Pedro Augusto Dantas Aranda" -> "Pedro A." (primeiro nome + inicial do último sobrenome).
function abbreviateName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Cliente';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

function nowIso() { return new Date().toISOString(); }

function safeJson(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

function tooMany(seconds, what = 'Muitas tentativas') {
  return httpError(429, `${what}. Por segurança, aguarde ${sec.minutesText(seconds)} e tente novamente.`, 'too_many_attempts', { retryAfter: seconds });
}

// ----------------------------------------------------------------------------
// Usuários e sessões
// ----------------------------------------------------------------------------
function isAdmin(u) { return Boolean(u && ADMIN_EMAIL && u.email === ADMIN_EMAIL); }

function publicUser(u) {
  return u ? { id: u.id, name: u.name, email: u.email, role: u.role, isAdmin: isAdmin(u) } : null;
}

function currentUser(req) {
  if (req._user !== undefined) return req._user;
  const token = sec.parseCookies(req).ff_session;
  req._user = token
    ? db.get('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?', [sec.hashToken(token), Date.now()])
    : null;
  return req._user;
}

// Cria uma sessão nova e devolve o cabeçalho Set-Cookie. O banco guarda só o hash do token.
function createSession(req, userId) {
  const token = sec.newToken();
  const now = Date.now();
  db.run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [sec.hashToken(token), userId, now, now + SESSION_DAYS * 86400000]);
  return sec.sessionCookie(req, token, SESSION_DAYS * 86400);
}

function dropCurrentSession(req) {
  const token = sec.parseCookies(req).ff_session;
  if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', [sec.hashToken(token)]);
}

function requireUser(req) {
  const user = currentUser(req);
  if (!user) throw httpError(401, 'Faça login para continuar.', 'auth_required');
  return user;
}

function requireRestaurantUser(req) {
  const user = requireUser(req);
  if (user.role !== 'restaurante') throw httpError(403, 'Apenas contas do tipo Restaurante podem gerenciar restaurantes.', 'not_restaurant');
  return user;
}

function requireClient(req, message) {
  const user = currentUser(req);
  if (!user) throw httpError(401, message || 'Entre na sua conta de cliente para continuar.', 'auth_required');
  if (user.role !== 'cliente') throw httpError(403, 'Esta ação é exclusiva de contas do tipo Cliente.', 'not_client');
  return user;
}

function requireAdmin(req) {
  const user = requireUser(req);
  if (!isAdmin(user)) throw httpError(403, 'Apenas o administrador pode acessar esta área.', 'not_admin');
  return user;
}

async function verifyPassword(user, password) {
  return sec.checkPassword(String(password || ''), user.password_hash);
}

function validNewPassword(password) {
  const p = String(password || '');
  if (p.length < 8) throw httpError(400, 'A senha precisa ter pelo menos 8 caracteres.', 'weak_password');
  if (p.length > 200) throw httpError(400, 'A senha pode ter no máximo 200 caracteres.', 'weak_password');
  return p;
}

// Cria a conta de administrador na primeira execução, se ADMIN_PASSWORD estiver definido.
async function ensureAdminAccount() {
  if (!ADMIN_EMAIL) return;
  if (db.get('SELECT id FROM users WHERE email = ?', [ADMIN_EMAIL])) return;
  const password = process.env.ADMIN_PASSWORD || '';
  if (password.length < 8) {
    console.warn('Aviso: ADMIN_EMAIL definido, mas a conta ainda não existe. Defina ADMIN_PASSWORD (mín. 8 caracteres) ou rode "npm run seed".');
    return;
  }
  const now = nowIso();
  db.run('INSERT INTO users (name, email, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ['Administrador FoodFind', ADMIN_EMAIL, await sec.hashPassword(password), 'cliente', now, now]);
  console.log('Conta de administrador criada para o e-mail definido em ADMIN_EMAIL.');
}

// ----------------------------------------------------------------------------
// Fotos (uploads)
// ----------------------------------------------------------------------------
function detectImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

function ownedFiles(userId) {
  return new Set(db.all('SELECT file FROM uploads WHERE owner_id = ?', [userId]).map(r => r.file));
}

function photoFiles(photosJson) {
  return safeJson(photosJson || '[]', []).map(p => (PHOTO_PATH.exec(String(p)) || [])[1]).filter(Boolean);
}

// Fotos usadas por algum restaurante ou por pedido de reivindicação pendente.
function referencedFiles() {
  const used = new Set();
  for (const r of db.all('SELECT photos FROM restaurants')) photoFiles(r.photos).forEach(f => used.add(f));
  for (const c of db.all("SELECT data FROM claims WHERE status = 'pendente'")) photoFiles(safeJson(c.data, {}).photos).forEach(f => used.add(f));
  return used;
}

function removeFiles(files) {
  for (const f of files) {
    if (!/^[a-f0-9-]{36}\.(jpg|png|webp)$/.test(f)) continue;
    fs.promises.unlink(path.join(db.UPLOAD_DIR, f)).catch(() => {});
  }
}

// Apaga as fotos indicadas que não estão mais em uso (nem no banco, nem em pedidos pendentes).
function deletePhotosIfUnused(files) {
  if (!files.length) return;
  const used = referencedFiles();
  const orphan = files.filter(f => !used.has(f));
  for (const f of orphan) db.run('DELETE FROM uploads WHERE file = ?', [f]);
  removeFiles(orphan);
}

// Limpeza periódica: fotos enviadas há mais de 24 h e nunca usadas.
function cleanOrphanUploads(maxAgeMs = 24 * 3600 * 1000) {
  const used = referencedFiles();
  const old = db.all('SELECT file FROM uploads WHERE created_at < ?', [Date.now() - maxAgeMs]).map(r => r.file).filter(f => !used.has(f));
  if (old.length) db.tx(() => old.forEach(f => db.run('DELETE FROM uploads WHERE file = ?', [f])));
  removeFiles(old);
  return old.length;
}

// ----------------------------------------------------------------------------
// Restaurantes
// ----------------------------------------------------------------------------
function placeRefOf(row) { return row.osm_ref || `ff-${row.id}`; }

function ratingSummaries() {
  const map = new Map();
  for (const r of db.all('SELECT place_ref, AVG(rating) AS avg, COUNT(*) AS count FROM reviews GROUP BY place_ref')) {
    map.set(r.place_ref, { rating: Math.round(r.avg * 10) / 10, reviewCount: r.count });
  }
  return map;
}

function summaryFor(ref, summaries) {
  return (summaries || ratingSummaries()).get(ref) || { rating: null, reviewCount: 0 };
}

function editableRestaurant(row) {
  const s = summaryFor(placeRefOf(row));
  return {
    id: row.id, osmRef: row.osm_ref, name: row.name, category: row.category, cuisine: row.cuisine,
    description: row.description, website: row.website, phone: row.phone, whatsapp: row.whatsapp,
    instagram: row.instagram, deliveryUrl: row.delivery_url, menuUrl: row.menu_url, priceRange: row.price_range,
    address: row.address, lat: row.lat, lng: row.lng,
    hours: safeJson(row.hours, {}), menu: safeJson(row.menu, []), photos: safeJson(row.photos, []),
    publicId: `ff-${row.id}`, updatedAt: row.updated_at, rating: s.rating, reviewCount: s.reviewCount,
    activeCampaigns: db.get("SELECT COUNT(*) AS n FROM campaigns WHERE restaurant_id = ? AND active = 1 AND ends_at > ?", [row.id, nowIso()]).n
  };
}

function publicRestaurant(row, center, summaries) {
  const photos = safeJson(row.photos, []);
  const schedule = safeJson(row.hours, {});
  const km = center ? haversine(center.lat, center.lng, row.lat, row.lng) : null;
  const s = summaryFor(placeRefOf(row), summaries);
  return {
    id: `ff-${row.id}`,
    registered: true,
    ownerId: row.owner_id,
    osmRef: row.osm_ref,
    name: row.name,
    category: row.category || 'Restaurante',
    cuisine: row.cuisine || '',
    rating: s.rating,
    reviewCount: s.reviewCount,
    distanceKm: km,
    distance: km == null ? '' : formatDistance(km),
    address: row.address || 'Endereço não informado',
    phone: row.phone || 'Telefone não informado',
    whatsapp: row.whatsapp || '',
    instagram: row.instagram || '',
    deliveryUrl: row.delivery_url || '',
    menuUrl: row.menu_url || '',
    priceRange: row.price_range || '',
    schedule,
    openNow: time.isOpenBySchedule(schedule),
    hours: 'Veja os horários no perfil',
    description: row.description || (row.cuisine ? `Culinária: ${row.cuisine}.` : 'Restaurante cadastrado no FoodFind.'),
    menu: safeJson(row.menu, []),
    website: row.website || '',
    photos,
    image: photos[0] || '',
    lat: row.lat,
    lng: row.lng,
    updatedAt: row.updated_at
  };
}

function publicOsm(place, center, summaries) {
  const km = center ? haversine(center.lat, center.lng, place.lat, place.lng) : null;
  const s = summaryFor(place.id, summaries);
  const { openingHours, ...rest } = place;
  return {
    ...rest,
    rating: s.rating,
    reviewCount: s.reviewCount,
    openNow: osm.isOpenByOsm(openingHours),
    distanceKm: km,
    distance: km == null ? '' : formatDistance(km)
  };
}

function numParam(u, name) {
  const raw = u.searchParams.get(name);
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function searchRestaurants(u) {
  let lat = numParam(u, 'lat'), lng = numParam(u, 'lng');
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) ({ lat, lng } = DEFAULT_LOCATION);
  let radius = numParam(u, 'radius');
  radius = radius === null ? DEFAULT_RADIUS_KM : Math.min(MAX_RADIUS_KM, Math.max(0.5, radius));
  radius = Math.round(radius * 10) / 10;
  const q = str(u.searchParams.get('q'), 100);
  // Aceita uma ou várias categorias separadas por vírgula (chips de seleção múltipla). Valores fora da lista são ignorados.
  const categories = [...new Set(String(u.searchParams.get('category') || '').split(',').map(c => c.trim()).filter(c => CATEGORIES.includes(c)))];
  const category = categories.join(',');
  const price = PRICE_RANGES.includes(u.searchParams.get('price')) ? u.searchParams.get('price') : '';
  const openOnly = u.searchParams.get('open') === '1';
  const minRating = Math.min(5, Math.max(0, numParam(u, 'minRating') || 0));
  const sort = ['distance', 'rating', 'name'].includes(u.searchParams.get('sort')) ? u.searchParams.get('sort') : 'distance';

  let places = [], warning = '';
  try {
    const found = await osm.searchAround(lat, lng, radius);
    places = found.places;
    if (found.stale) {
      sec.logError('OpenStreetMap (usando a última consulta salva)', found.error);
      warning = 'O OpenStreetMap está lento agora; mostrando os restaurantes da última consulta feita nesta região.';
    }
  } catch (e) {
    sec.logError('OpenStreetMap', e);
    warning = 'O OpenStreetMap não respondeu agora; mostrando apenas os restaurantes cadastrados no FoodFind.';
  }

  const registered = db.all('SELECT * FROM restaurants');
  const linkedRefs = new Set(registered.map(r => r.osm_ref).filter(Boolean));
  const center = { lat, lng };
  const summaries = ratingSummaries();

  const list = places.filter(o => {
    if (linkedRefs.has(o.id)) return false;
    const n = normalizeName(o.name);
    return !registered.some(r => !r.osm_ref && normalizeName(r.name) === n && haversine(r.lat, r.lng, o.lat, o.lng) < 0.15);
  }).map(o => publicOsm(o, center, summaries)).filter(o => o.distanceKm <= radius);

  for (const r of registered) {
    if (haversine(lat, lng, r.lat, r.lng) <= radius) list.push(publicRestaurant(r, center, summaries));
  }

  const term = normalizeName(q);
  const filtered = list.filter(r => {
    if (term) {
      const text = [r.name, r.category, r.cuisine, r.description, ...(r.menu || []).map(m => `${m.name} ${m.section}`)].join(' ');
      if (!normalizeName(text).includes(term)) return false;
    }
    if (categories.length && !categories.includes(r.category)) return false;
    if (price && r.priceRange !== price) return false;
    if (openOnly && r.openNow !== true) return false;
    if (minRating && !(r.rating >= minRating)) return false;
    return true;
  });

  const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR');
  if (sort === 'name') filtered.sort(byName);
  else if (sort === 'rating') filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0) || b.reviewCount - a.reviewCount || a.distanceKm - b.distanceKm);
  else filtered.sort((a, b) => a.distanceKm - b.distanceKm);

  return {
    source: 'OpenStreetMap + FoodFind',
    center, radiusKm: radius,
    filters: { q, category, price, open: openOnly, minRating, sort },
    total: filtered.length,
    restaurants: filtered.slice(0, MAX_RESULTS),
    warning
  };
}

// Localiza um lugar (cadastrado ou do OSM) para avaliações e perfil.
async function resolvePlace(ref, { fetchOsm = true } = {}) {
  const ff = /^ff-(\d{1,9})$/.exec(ref);
  if (ff) {
    const row = db.get('SELECT * FROM restaurants WHERE id = ?', [Number(ff[1])]);
    if (!row) throw httpError(404, 'Restaurante não encontrado.', 'not_found');
    return { placeRef: placeRefOf(row), name: row.name, row };
  }
  if (!osm.OSM_REF.test(ref)) throw httpError(404, 'Restaurante não encontrado.', 'not_found');
  const row = db.get('SELECT * FROM restaurants WHERE osm_ref = ?', [ref]);
  if (row) return { placeRef: ref, name: row.name, row };
  const known = osm.knownPlace(ref);
  if (known) return { placeRef: ref, name: known.name, place: known };
  if (!fetchOsm) {
    const prev = db.get('SELECT place_name FROM reviews WHERE place_ref = ? LIMIT 1', [ref]);
    return { placeRef: ref, name: prev ? prev.place_name : '' };
  }
  let place;
  try { place = await osm.findByRef(ref); }
  catch (e) {
    sec.logError('OpenStreetMap', e);
    const prev = db.get('SELECT place_name FROM reviews WHERE place_ref = ? LIMIT 1', [ref]);
    if (prev) return { placeRef: ref, name: prev.place_name };
    throw httpError(503, 'Não foi possível consultar o OpenStreetMap agora. Tente novamente em instantes.', 'osm_unavailable');
  }
  if (!place) throw httpError(404, 'Restaurante não encontrado no OpenStreetMap.', 'not_found');
  return { placeRef: ref, name: place.name, place };
}

function restaurantForOwner(user, id) {
  const row = db.get('SELECT * FROM restaurants WHERE id = ?', [Number(id)]);
  if (!row || row.owner_id !== user.id) throw httpError(404, 'Restaurante não encontrado na sua conta.', 'not_found');
  return row;
}

// Exclui um restaurante, suas campanhas/resgates (cascata), avaliações próprias e fotos.
function deleteRestaurantCascade(row) {
  const files = photoFiles(row.photos);
  db.tx(() => {
    // Restaurantes assumidos do OSM mantêm as avaliações do lugar; os criados no FoodFind levam junto.
    if (!row.osm_ref) db.run('DELETE FROM reviews WHERE place_ref = ?', [`ff-${row.id}`]);
    db.run('DELETE FROM restaurants WHERE id = ?', [row.id]);
  });
  deletePhotosIfUnused(files);
}

// ----------------------------------------------------------------------------
// Avaliações
// ----------------------------------------------------------------------------
function reviewView(r, userId) {
  return {
    id: r.id, rating: r.rating, comment: r.comment, author: abbreviateName(r.user_name),
    createdAt: r.created_at, updatedAt: r.updated_at, edited: r.updated_at !== r.created_at, mine: r.user_id === userId
  };
}

function reviewSummary(placeRef) {
  const s = db.get('SELECT AVG(rating) AS avg, COUNT(*) AS count FROM reviews WHERE place_ref = ?', [placeRef]);
  const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  for (const d of db.all('SELECT rating, COUNT(*) AS n FROM reviews WHERE place_ref = ? GROUP BY rating', [placeRef])) distribution[d.rating] = d.n;
  return { average: s.count ? Math.round(s.avg * 10) / 10 : 0, count: s.count, distribution };
}

function myReview(placeRef, user) {
  if (!user) return null;
  const r = db.get('SELECT rv.*, u.name AS user_name FROM reviews rv JOIN users u ON u.id = rv.user_id WHERE rv.place_ref = ? AND rv.user_id = ?', [placeRef, user.id]);
  return r ? reviewView(r, user.id) : null;
}

async function saveReview(req, ref) {
  const user = requireClient(req, 'Entre como cliente para avaliar.');
  const b = await readBody(req);
  const rating = Number(b.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw httpError(400, 'A nota deve ser um número inteiro de 1 a 5.', 'invalid_rating');
  const comment = str(b.comment, 5000);
  if (comment.length > REVIEW_MAX) throw httpError(400, `O comentário pode ter no máximo ${REVIEW_MAX} caracteres.`, 'comment_too_long');
  const { placeRef, name } = await resolvePlace(ref);
  const now = nowIso();
  const existing = db.get('SELECT id FROM reviews WHERE place_ref = ? AND user_id = ?', [placeRef, user.id]);
  if (existing) db.run('UPDATE reviews SET rating = ?, comment = ?, place_name = ?, updated_at = ? WHERE id = ?', [rating, comment, name, now, existing.id]);
  else db.run('INSERT INTO reviews (place_ref, place_name, user_id, rating, comment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [placeRef, name, user.id, rating, comment, now, now]);
  return { status: existing ? 200 : 201, body: { ok: true, created: !existing, review: myReview(placeRef, user), ...reviewSummary(placeRef) } };
}

// ----------------------------------------------------------------------------
// Campanhas, QR Code e vouchers
// ----------------------------------------------------------------------------
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem I, O, 0 e 1 (fáceis de confundir)

// Código secreto de 16 caracteres (80 bits) gerado com crypto.randomBytes.
function newCampaignCode() {
  const bytes = crypto.randomBytes(10);
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) { out += CODE_ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return out;
}

// Aceita o código puro, com hífens/espaços ou o link completo ?resgatar=CODIGO.
function normalizeCode(input) {
  let s = str(input, 600);
  const m = /[?&]resgatar=([^&#\s]+)/i.exec(s);
  if (m) { try { s = decodeURIComponent(m[1]); } catch { s = m[1]; } }
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 80);
}

function formatCode(code) {
  return code.length === 16 ? code.match(/.{4}/g).join('-') : code;
}

function discountLabel(type, value) {
  if (type === 'percent') return `${String(value).replace('.', ',')}% de desconto`;
  return `${Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} de desconto`;
}

function usedCount(campaignId) {
  return db.get('SELECT COUNT(*) AS n FROM redemptions WHERE campaign_id = ?', [campaignId]).n;
}

function campaignStatus(c, used, now = Date.now()) {
  if (now > Date.parse(c.ends_at)) return 'encerrada';
  if (!c.active) return 'pausada';
  if (c.max_redemptions != null && used >= c.max_redemptions) return 'esgotada';
  if (now < Date.parse(c.starts_at)) return 'agendada';
  return 'ativa';
}

function publicBaseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const host = /^[a-z0-9.-]+(:\d{1,5})?$/i.test(String(req.headers.host || '')) ? req.headers.host : `localhost:${PORT}`;
  return `${sec.isHttps(req) ? 'https' : 'http'}://${host}`;
}

function redeemUrl(req, code) {
  return `${publicBaseUrl(req)}/?resgatar=${encodeURIComponent(code)}`;
}

// Visão do dono (inclui o código secreto e o link do QR).
function ownerCampaign(req, c) {
  const used = usedCount(c.id);
  return {
    id: c.id, restaurantId: c.restaurant_id, restaurantPublicId: `ff-${c.restaurant_id}`, restaurantName: c.restaurant_name,
    title: c.title, description: c.description, discountType: c.discount_type, discountValue: c.discount_value,
    discountLabel: discountLabel(c.discount_type, c.discount_value),
    startsAt: c.starts_at, endsAt: c.ends_at,
    startsAtLocal: time.toSaoPauloInput(c.starts_at), endsAtLocal: time.toSaoPauloInput(c.ends_at),
    maxRedemptions: c.max_redemptions, redemptionCount: used,
    vouchersUsed: db.get("SELECT COUNT(*) AS n FROM redemptions WHERE campaign_id = ? AND status = 'usado'", [c.id]).n,
    active: Boolean(c.active), status: campaignStatus(c, used),
    code: c.code, codeFormatted: formatCode(c.code), redeemUrl: redeemUrl(req, c.code),
    qrUrl: `/api/my/campaigns/${c.id}/qr.svg`, createdAt: c.created_at, updatedAt: c.updated_at
  };
}

// Visão pública: nunca inclui o código.
function publicCampaign(c) {
  const used = usedCount(c.id);
  return {
    id: c.id, title: c.title, benefit: c.description,
    discountType: c.discount_type, discountValue: c.discount_value, discountLabel: discountLabel(c.discount_type, c.discount_value),
    startsAt: c.starts_at, endsAt: c.ends_at, validUntil: time.formatSaoPaulo(c.ends_at),
    hasSlots: c.max_redemptions == null || used < c.max_redemptions
  };
}

function ownerCampaignRow(user, id) {
  const c = db.get(`SELECT c.*, r.name AS restaurant_name, r.owner_id FROM campaigns c JOIN restaurants r ON r.id = c.restaurant_id WHERE c.id = ?`, [Number(id)]);
  if (!c || c.owner_id !== user.id) throw httpError(404, 'Campanha não encontrada na sua conta.', 'not_found');
  return c;
}

function cleanCampaign(b, { usedNow = 0 } = {}) {
  const title = str(b.title, 120);
  const description = str(b.description, 500);
  const discountType = b.discountType === 'fixed' ? 'fixed' : b.discountType === 'percent' ? 'percent' : '';
  const discountValue = Math.round(Number(b.discountValue) * 100) / 100;
  if (!title) throw httpError(400, 'Informe o título da campanha.', 'invalid_title');
  if (!description) throw httpError(400, 'Descreva o benefício da campanha (ex.: "15% no almoço de segunda a sexta").', 'invalid_description');
  if (!discountType) throw httpError(400, 'Escolha o tipo de desconto: percentual ou valor fixo.', 'invalid_discount');
  if (!Number.isFinite(discountValue) || discountValue <= 0 || (discountType === 'percent' && discountValue > 100) || discountValue > 100000) {
    throw httpError(400, 'Desconto inválido (percentual de 1 a 100 ou valor fixo positivo).', 'invalid_discount');
  }
  const start = time.parseSaoPaulo(b.startsAt), end = time.parseSaoPaulo(b.endsAt);
  if (!start || !end) throw httpError(400, 'Informe datas de início e fim válidas.', 'invalid_period');
  if (end <= start) throw httpError(400, 'A data de fim deve ser posterior à data de início.', 'invalid_period');
  let maxRedemptions = null;
  if (b.maxRedemptions !== undefined && b.maxRedemptions !== null && b.maxRedemptions !== '') {
    maxRedemptions = Number(b.maxRedemptions);
    if (!Number.isInteger(maxRedemptions) || maxRedemptions < 1 || maxRedemptions > 100000) throw httpError(400, 'O limite de usos deve ser um número inteiro de 1 a 100.000 (ou fique em branco para não limitar).', 'invalid_limit');
    if (maxRedemptions < usedNow) throw httpError(400, `O limite não pode ser menor que os ${usedNow} resgates já feitos.`, 'invalid_limit');
  }
  return { title, description, discountType, discountValue, startsAt: start.toISOString(), endsAt: end.toISOString(), maxRedemptions };
}

function voucherNumber(id) { return `FF-${String(id).padStart(6, '0')}`; }

function parseVoucher(s) {
  const m = /^FF-?0*(\d{1,9})$/i.exec(String(s || '').trim());
  return m ? Number(m[1]) : null;
}

const REDEMPTION_SELECT = `SELECT x.*, c.title, c.description, c.discount_type, c.discount_value, c.starts_at, c.ends_at, c.restaurant_id,
  r.name AS restaurant_name, r.owner_id, u.name AS user_name
  FROM redemptions x JOIN campaigns c ON c.id = x.campaign_id JOIN restaurants r ON r.id = c.restaurant_id JOIN users u ON u.id = x.user_id`;

function voucherView(x, { forOwner = false } = {}) {
  const expired = Date.now() > Date.parse(x.ends_at);
  const v = {
    voucher: voucherNumber(x.id),
    status: x.status,
    statusLabel: x.status === 'usado' ? 'Usado' : expired ? 'Expirado' : 'Emitido',
    expired,
    restaurantName: x.restaurant_name, restaurantId: `ff-${x.restaurant_id}`,
    campaignTitle: x.title, benefit: x.description, discountLabel: discountLabel(x.discount_type, x.discount_value),
    validUntil: x.ends_at, validUntilText: time.formatSaoPaulo(x.ends_at),
    redeemedAt: x.redeemed_at, usedAt: x.used_at
  };
  if (forOwner) v.client = abbreviateName(x.user_name);
  else v.checkCode = x.check_code;
  return v;
}

function ownerVoucher(user, number) {
  const id = parseVoucher(number);
  const x = id ? db.get(`${REDEMPTION_SELECT} WHERE x.id = ?`, [id]) : null;
  if (!x || x.owner_id !== user.id) throw httpError(404, 'Voucher não encontrado entre as campanhas dos seus restaurantes.', 'voucher_not_found');
  return x;
}

// ----------------------------------------------------------------------------
// Reivindicação de restaurantes do OSM
// ----------------------------------------------------------------------------
function claimView(c, { forAdmin = false } = {}) {
  const data = safeJson(c.data, {});
  const v = {
    id: c.id, osmRef: c.osm_ref, status: c.status, message: c.message, reason: c.reason,
    name: data.name, address: data.address, category: data.category, lat: data.lat, lng: data.lng,
    restaurantId: c.restaurant_id ? `ff-${c.restaurant_id}` : null,
    createdAt: c.created_at, decidedAt: c.decided_at,
    osmUrl: `https://www.openstreetmap.org/${c.osm_ref.replace('-', '/')}`
  };
  if (forAdmin) { v.requester = { name: c.user_name, email: c.user_email }; v.phone = data.phone; v.website = data.website; }
  return v;
}

// ----------------------------------------------------------------------------
// Exportação e exclusão de conta (LGPD)
// ----------------------------------------------------------------------------
function exportData(user) {
  const restaurants = db.all('SELECT * FROM restaurants WHERE owner_id = ?', [user.id]);
  return {
    exportadoEm: nowIso(),
    aplicacao: `FoodFind ${VERSION}`,
    conta: { id: user.id, nome: user.name, email: user.email, tipo: user.role, criadaEm: user.created_at, atualizadaEm: user.updated_at },
    sessoesAtivas: db.all('SELECT created_at, expires_at FROM sessions WHERE user_id = ? AND expires_at > ?', [user.id, Date.now()])
      .map(s => ({ criadaEm: new Date(s.created_at).toISOString(), expiraEm: new Date(s.expires_at).toISOString() })),
    avaliacoes: db.all('SELECT place_ref, place_name, rating, comment, created_at, updated_at FROM reviews WHERE user_id = ? ORDER BY created_at', [user.id])
      .map(r => ({ lugar: r.place_name, referencia: r.place_ref, nota: r.rating, comentario: r.comment, criadaEm: r.created_at, atualizadaEm: r.updated_at })),
    beneficios: db.all(`${REDEMPTION_SELECT} WHERE x.user_id = ? ORDER BY x.redeemed_at`, [user.id]).map(x => voucherView(x)),
    restaurantes: restaurants.map(r => ({ ...editableRestaurant(r) })),
    campanhas: db.all(`SELECT c.title, c.description, c.discount_type, c.discount_value, c.starts_at, c.ends_at, c.max_redemptions, c.active, r.name AS restaurante
      FROM campaigns c JOIN restaurants r ON r.id = c.restaurant_id WHERE r.owner_id = ?`, [user.id]),
    reivindicacoes: db.all('SELECT * FROM claims WHERE user_id = ?', [user.id]).map(c => claimView(c))
  };
}

function deleteAccount(user) {
  const files = db.all('SELECT file FROM uploads WHERE owner_id = ?', [user.id]).map(r => r.file);
  db.tx(() => {
    for (const r of db.all('SELECT id, osm_ref FROM restaurants WHERE owner_id = ?', [user.id])) {
      if (!r.osm_ref) db.run('DELETE FROM reviews WHERE place_ref = ?', [`ff-${r.id}`]);
    }
    // ON DELETE CASCADE apaga sessões, restaurantes, campanhas, resgates, avaliações, pedidos e registros de fotos.
    db.run('DELETE FROM users WHERE id = ?', [user.id]);
  });
  removeFiles(files);
}

// ----------------------------------------------------------------------------
// API
// ----------------------------------------------------------------------------
const PLACE_ROUTE = /^\/api\/restaurants\/(ff-\d{1,9}|(?:node|way|relation)-\d{1,15})(\/reviews|\/reviews\/mine|\/campaigns)?$/;

async function api(req, res, u) {
  const method = req.method;
  const p = u.pathname;
  const ip = sec.clientIp(req);

  // Proteção contra CSRF: alterações só a partir do próprio site.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && sec.isForeignOrigin(req)) {
    throw httpError(403, 'Origem da requisição não permitida.', 'bad_origin');
  }

  // ---------------- Autenticação ----------------
  if (p === '/api/auth/register' && method === 'POST') {
    const b = await readBody(req);
    const name = str(b.name, 100);
    const email = str(b.email, 200).toLowerCase();
    const role = b.role === 'restaurante' ? 'restaurante' : 'cliente';
    const waitIp = sec.limits.registerIp.consume(ip);
    if (waitIp) throw tooMany(waitIp, 'Muitos cadastros feitos a partir desta rede');
    if (!name || !isEmail(email)) throw httpError(400, 'Preencha nome e um e-mail válido.', 'invalid_fields');
    const password = validNewPassword(b.password);
    if (b.acceptTerms !== true) throw httpError(400, 'Para criar a conta, aceite os Termos de Uso e a Política de Privacidade.', 'terms_required');
    const waitEmail = sec.limits.registerEmail.consume(email);
    if (waitEmail) throw tooMany(waitEmail, 'Muitas tentativas de cadastro para este e-mail');
    if (ADMIN_EMAIL && email === ADMIN_EMAIL) throw httpError(403, 'Este e-mail é reservado. Use outro endereço.', 'reserved_email');
    if (db.get('SELECT id FROM users WHERE email = ?', [email])) throw httpError(409, 'Este e-mail já está cadastrado. Faça login ou use outro e-mail.', 'email_taken');
    const now = nowIso();
    const id = db.run('INSERT INTO users (name, email, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [name, email, await sec.hashPassword(password), role, now, now]);
    dropCurrentSession(req);
    const user = db.get('SELECT * FROM users WHERE id = ?', [id]);
    return send(res, 201, { user: publicUser(user) }, undefined, { 'Set-Cookie': createSession(req, id) });
  }

  if (p === '/api/auth/login' && method === 'POST') {
    const b = await readBody(req);
    const email = str(b.email, 200).toLowerCase();
    const waitEmail = sec.limits.loginEmail.retryAfter(email);
    if (waitEmail) throw tooMany(waitEmail, 'Muitas tentativas de login para este e-mail');
    const waitIp = sec.limits.loginIp.consume(ip);
    if (waitIp) throw tooMany(waitIp, 'Muitas tentativas de login a partir desta rede');
    const user = db.get('SELECT * FROM users WHERE email = ?', [email]);
    const ok = await sec.checkPassword(String(b.password || ''), user ? user.password_hash : undefined);
    if (!user || !ok) {
      const blocked = sec.limits.loginEmail.hit(email);
      if (blocked) throw tooMany(blocked, 'Muitas tentativas de login para este e-mail');
      throw httpError(401, 'E-mail ou senha incorretos.', 'invalid_credentials');
    }
    sec.limits.loginEmail.reset(email);
    dropCurrentSession(req); // rotação: a sessão anterior deste navegador deixa de valer
    return send(res, 200, { user: publicUser(user) }, undefined, { 'Set-Cookie': createSession(req, user.id) });
  }

  if (p === '/api/auth/logout' && method === 'POST') {
    dropCurrentSession(req);
    return send(res, 200, { ok: true }, undefined, { 'Set-Cookie': sec.sessionCookie(req, '', 0) });
  }

  if (p === '/api/auth/me' && method === 'GET') {
    return send(res, 200, { user: publicUser(currentUser(req)) });
  }

  // ---------------- Minha conta ----------------
  if (p === '/api/me' && method === 'PUT') {
    const user = requireUser(req);
    const b = await readBody(req);
    const name = str(b.name, 100);
    if (name.length < 2) throw httpError(400, 'Informe seu nome.', 'invalid_fields');
    db.run('UPDATE users SET name = ?, updated_at = ? WHERE id = ?', [name, nowIso(), user.id]);
    return send(res, 200, { user: publicUser(db.get('SELECT * FROM users WHERE id = ?', [user.id])) });
  }

  if (p === '/api/me/password' && method === 'POST') {
    const user = requireUser(req);
    const b = await readBody(req);
    if (!(await verifyPassword(user, b.currentPassword))) throw httpError(400, 'A senha atual não confere.', 'wrong_password');
    const password = validNewPassword(b.newPassword);
    const hash = await sec.hashPassword(password);
    db.tx(() => {
      db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [hash, nowIso(), user.id]);
      db.run('DELETE FROM sessions WHERE user_id = ?', [user.id]); // encerra os outros dispositivos
    });
    return send(res, 200, { ok: true, message: 'Senha alterada. As outras sessões foram encerradas.' }, undefined, { 'Set-Cookie': createSession(req, user.id) });
  }

  if (p === '/api/me/logout-all' && method === 'POST') {
    const user = requireUser(req);
    db.run('DELETE FROM sessions WHERE user_id = ?', [user.id]);
    return send(res, 200, { ok: true }, undefined, { 'Set-Cookie': sec.sessionCookie(req, '', 0) });
  }

  if (p === '/api/me/export' && method === 'GET') {
    const user = requireUser(req);
    const day = time.toSaoPauloInput(nowIso()).slice(0, 10);
    return send(res, 200, exportData(user), undefined, { 'Content-Disposition': `attachment; filename="foodfind-meus-dados-${day}.json"` });
  }

  if (p === '/api/me' && method === 'DELETE') {
    const user = requireUser(req);
    const b = await readBody(req);
    if (!(await verifyPassword(user, b.password))) throw httpError(400, 'Senha incorreta. A conta não foi excluída.', 'wrong_password');
    if (isAdmin(user)) throw httpError(403, 'A conta do administrador não pode ser excluída pelo app. Altere ADMIN_EMAIL antes.', 'admin_account');
    deleteAccount(user);
    return send(res, 200, { ok: true, message: 'Sua conta e seus dados foram excluídos.' }, undefined, { 'Set-Cookie': sec.sessionCookie(req, '', 0) });
  }

  if (p === '/api/me/redemptions' && method === 'GET') {
    const user = requireClient(req);
    const rows = db.all(`${REDEMPTION_SELECT} WHERE x.user_id = ? ORDER BY x.redeemed_at DESC, x.id DESC`, [user.id]);
    return send(res, 200, { redemptions: rows.map(x => voucherView(x)) });
  }

  // ---------------- Busca e perfis ----------------
  if (p === '/api/restaurants' && method === 'GET') {
    const wait = sec.limits.search.consume(ip);
    if (wait) throw tooMany(wait, 'Muitas buscas em pouco tempo');
    return send(res, 200, await searchRestaurants(u));
  }

  const place = PLACE_ROUTE.exec(p);
  if (place) {
    const [, ref, sub] = place;
    const user = currentUser(req);

    if (!sub && method === 'GET') {
      const lat = numParam(u, 'lat'), lng = numParam(u, 'lng');
      const center = lat !== null && lng !== null ? { lat, lng } : null;
      const found = await resolvePlace(ref);
      if (found.row) return send(res, 200, { restaurant: publicRestaurant(found.row, center) });
      const pub = publicOsm(found.place, center);
      if (user && user.role === 'restaurante') {
        const claim = db.get('SELECT * FROM claims WHERE osm_ref = ? AND user_id = ? ORDER BY id DESC LIMIT 1', [ref, user.id]);
        pub.myClaim = claim ? claimView(claim) : null;
        pub.claimPending = Boolean(db.get("SELECT id FROM claims WHERE osm_ref = ? AND status = 'pendente'", [ref]));
      }
      return send(res, 200, { restaurant: pub });
    }

    if (sub === '/reviews' && method === 'GET') {
      const { placeRef } = await resolvePlace(ref, { fetchOsm: false });
      const limit = Math.min(20, Math.max(1, Math.floor(numParam(u, 'limit') || 5)));
      const summary = reviewSummary(placeRef);
      const pages = Math.max(1, Math.ceil(summary.count / limit));
      const page = Math.min(pages, Math.max(1, Math.floor(numParam(u, 'page') || 1)));
      const rows = db.all(`SELECT rv.*, u.name AS user_name FROM reviews rv JOIN users u ON u.id = rv.user_id
        WHERE rv.place_ref = ? ORDER BY rv.updated_at DESC, rv.id DESC LIMIT ? OFFSET ?`, [placeRef, limit, (page - 1) * limit]);
      const canReview = Boolean(user && user.role === 'cliente');
      return send(res, 200, {
        placeRef, ...summary, page, pages, limit,
        reviews: rows.map(r => reviewView(r, user && user.id)),
        mine: myReview(placeRef, user),
        canReview,
        reason: canReview ? '' : user ? 'Contas do tipo Restaurante não avaliam restaurantes.' : 'Entre como cliente para avaliar.'
      });
    }

    if ((sub === '/reviews' && method === 'POST') || (sub === '/reviews/mine' && method === 'PUT')) {
      const { status, body } = await saveReview(req, ref);
      return send(res, status, body);
    }

    if (sub === '/reviews/mine' && method === 'GET') {
      const me = requireClient(req);
      const { placeRef } = await resolvePlace(ref, { fetchOsm: false });
      return send(res, 200, { review: myReview(placeRef, me) });
    }

    if (sub === '/reviews/mine' && method === 'DELETE') {
      const me = requireClient(req);
      const { placeRef } = await resolvePlace(ref, { fetchOsm: false });
      db.run('DELETE FROM reviews WHERE place_ref = ? AND user_id = ?', [placeRef, me.id]);
      if (!db.changes()) throw httpError(404, 'Você ainda não avaliou este restaurante.', 'not_found');
      return send(res, 200, { ok: true, ...reviewSummary(placeRef) });
    }

    if (sub === '/campaigns' && method === 'GET') {
      let row = null;
      const ff = /^ff-(\d+)$/.exec(ref);
      if (ff) {
        row = db.get('SELECT id FROM restaurants WHERE id = ?', [Number(ff[1])]);
        if (!row) throw httpError(404, 'Restaurante não encontrado.', 'not_found');
      } else row = db.get('SELECT id FROM restaurants WHERE osm_ref = ?', [ref]);
      if (!row) return send(res, 200, { campaigns: [] });
      const now = nowIso();
      const rows = db.all('SELECT * FROM campaigns WHERE restaurant_id = ? AND active = 1 AND starts_at <= ? AND ends_at > ? ORDER BY ends_at ASC', [row.id, now, now]);
      return send(res, 200, { campaigns: rows.map(publicCampaign) });
    }
  }

  // Descontos vigentes perto de um ponto (vitrine da tela inicial). Nunca inclui o código.
  if (p === '/api/campaigns/nearby' && method === 'GET') {
    let lat = numParam(u, 'lat'), lng = numParam(u, 'lng');
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) ({ lat, lng } = DEFAULT_LOCATION);
    const radius = Math.min(MAX_RADIUS_KM, Math.max(0.5, numParam(u, 'radius') || DEFAULT_RADIUS_KM));
    const now = nowIso();
    const rows = db.all(`SELECT c.*, r.name AS restaurant_name, r.lat, r.lng, r.category FROM campaigns c JOIN restaurants r ON r.id = c.restaurant_id
      WHERE c.active = 1 AND c.starts_at <= ? AND c.ends_at > ?`, [now, now]);
    const list = rows.map(c => ({ c, km: haversine(lat, lng, c.lat, c.lng) }))
      .filter(x => x.km <= radius)
      .map(x => ({ ...publicCampaign(x.c), restaurantId: `ff-${x.c.restaurant_id}`, restaurantName: x.c.restaurant_name, category: x.c.category, distanceKm: x.km, distance: formatDistance(x.km) }))
      .filter(x => x.hasSlots)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 8);
    return send(res, 200, { campaigns: list });
  }

  // ---------------- Endereços (protegido) ----------------
  if (p === '/api/geocode' && method === 'GET') {
    if (!sec.isSameSite(req)) throw httpError(403, 'Busca de endereço disponível apenas dentro do FoodFind.', 'bad_origin');
    const wait = sec.limits.geocode.consume(ip);
    if (wait) throw tooMany(wait, 'Muitas buscas de endereço');
    const q = str(u.searchParams.get('q'), 200);
    if (q.length < 3) return send(res, 200, { results: [] });
    return send(res, 200, { results: await geocode(q) });
  }

  // ---------------- Painel do restaurante ----------------
  if (p === '/api/my/restaurants' && method === 'GET') {
    const user = requireRestaurantUser(req);
    const rows = db.all('SELECT * FROM restaurants WHERE owner_id = ? ORDER BY updated_at DESC', [user.id]);
    return send(res, 200, { restaurants: rows.map(editableRestaurant) });
  }

  if (p === '/api/my/restaurants' && method === 'POST') {
    const user = requireRestaurantUser(req);
    const b = await readBody(req);
    if (b.osmRef) throw httpError(400, 'Para assumir um restaurante que já aparece no mapa, envie um pedido de reivindicação.', 'use_claim');
    const r = cleanRestaurant(b, ownedFiles(user.id));
    const now = nowIso();
    const id = db.run(
      `INSERT INTO restaurants (owner_id, osm_ref, ${FIELDS.join(', ')}, created_at, updated_at) VALUES (?, NULL, ${FIELDS.map(() => '?').join(', ')}, ?, ?)`,
      [user.id, ...FIELDS.map(f => r[f]), now, now]
    );
    return send(res, 201, { restaurant: editableRestaurant(db.get('SELECT * FROM restaurants WHERE id = ?', [id])) });
  }

  let m = p.match(/^\/api\/my\/restaurants\/(\d{1,9})$/);
  if (m && (method === 'PUT' || method === 'DELETE')) {
    const user = requireRestaurantUser(req);
    const row = restaurantForOwner(user, m[1]);
    if (method === 'DELETE') {
      deleteRestaurantCascade(row);
      return send(res, 200, { ok: true });
    }
    const r = cleanRestaurant(await readBody(req), ownedFiles(user.id));
    db.run(`UPDATE restaurants SET ${FIELDS.map(f => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [...FIELDS.map(f => r[f]), nowIso(), row.id]);
    const removed = photoFiles(row.photos).filter(f => !photoFiles(r.photos).includes(f));
    deletePhotosIfUnused(removed);
    return send(res, 200, { restaurant: editableRestaurant(db.get('SELECT * FROM restaurants WHERE id = ?', [row.id])) });
  }

  if (p === '/api/uploads' && method === 'POST') {
    const user = requireRestaurantUser(req);
    const b = await readBody(req, 8 * 1024 * 1024);
    const match = String(b.dataUrl || '').match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw httpError(400, 'Envie uma imagem JPG, PNG ou WEBP.', 'invalid_image');
    const buf = Buffer.from(match[2], 'base64');
    if (buf.length > 5 * 1024 * 1024) throw httpError(413, 'A imagem deve ter no máximo 5 MB.', 'too_large');
    const ext = detectImage(buf); // confere o conteúdo real do arquivo, não só o tipo declarado
    if (!ext) throw httpError(400, 'O arquivo não é uma imagem JPG, PNG ou WEBP válida.', 'invalid_image');
    if (db.get('SELECT COUNT(*) AS n FROM uploads WHERE owner_id = ?', [user.id]).n >= 200) throw httpError(400, 'Limite de fotos enviadas atingido. Remova fotos antigas.', 'upload_limit');
    const file = `${crypto.randomUUID()}.${ext}`;
    await fs.promises.writeFile(path.join(db.UPLOAD_DIR, file), buf, { flag: 'wx' });
    db.run('INSERT INTO uploads (file, owner_id, created_at) VALUES (?, ?, ?)', [file, user.id, Date.now()]);
    return send(res, 201, { url: `/uploads/${file}` });
  }

  // ---------------- Reivindicação ----------------
  if (p === '/api/my/claims' && method === 'GET') {
    const user = requireRestaurantUser(req);
    return send(res, 200, { claims: db.all('SELECT * FROM claims WHERE user_id = ? ORDER BY id DESC', [user.id]).map(c => claimView(c)) });
  }

  if (p === '/api/my/claims' && method === 'POST') {
    const user = requireRestaurantUser(req);
    const b = await readBody(req);
    const ref = String(b.osmRef || '');
    if (!osm.OSM_REF.test(ref)) throw httpError(400, 'Restaurante do mapa inválido.', 'invalid_ref');
    if (db.get('SELECT id FROM restaurants WHERE osm_ref = ?', [ref])) throw httpError(409, 'Este restaurante já foi assumido por um dono.', 'already_claimed');
    const pending = db.get("SELECT user_id FROM claims WHERE osm_ref = ? AND status = 'pendente'", [ref]);
    if (pending) throw httpError(409, pending.user_id === user.id ? 'Você já enviou um pedido para este restaurante. Aguarde a análise.' : 'Já existe um pedido em análise para este restaurante.', 'claim_pending');
    const r = cleanRestaurant(b, ownedFiles(user.id));
    const id = db.run('INSERT INTO claims (osm_ref, user_id, status, data, message, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [ref, user.id, 'pendente', JSON.stringify(r), str(b.message, 500), nowIso()]);
    return send(res, 201, { claim: claimView(db.get('SELECT * FROM claims WHERE id = ?', [id])) });
  }

  m = p.match(/^\/api\/my\/claims\/(\d{1,9})$/);
  if (m && method === 'DELETE') {
    const user = requireRestaurantUser(req);
    const c = db.get('SELECT * FROM claims WHERE id = ? AND user_id = ?', [Number(m[1]), user.id]);
    if (!c) throw httpError(404, 'Pedido não encontrado.', 'not_found');
    if (c.status !== 'pendente') throw httpError(409, 'Só é possível cancelar pedidos pendentes.', 'claim_decided');
    const files = photoFiles(safeJson(c.data, {}).photos);
    db.run('DELETE FROM claims WHERE id = ?', [c.id]);
    deletePhotosIfUnused(files);
    return send(res, 200, { ok: true });
  }

  // ---------------- Administração ----------------
  if (p === '/api/admin/claims' && method === 'GET') {
    requireAdmin(req);
    const status = ['pendente', 'aprovado', 'recusado'].includes(u.searchParams.get('status')) ? u.searchParams.get('status') : null;
    const rows = db.all(`SELECT c.*, us.name AS user_name, us.email AS user_email FROM claims c JOIN users us ON us.id = c.user_id
      ${status ? 'WHERE c.status = ?' : ''} ORDER BY c.status = 'pendente' DESC, c.id DESC`, status ? [status] : []);
    return send(res, 200, { claims: rows.map(c => claimView(c, { forAdmin: true })) });
  }

  m = p.match(/^\/api\/admin\/claims\/(\d{1,9})\/(approve|reject)$/);
  if (m && method === 'POST') {
    const admin = requireAdmin(req);
    const b = await readBody(req);
    const c = db.get('SELECT * FROM claims WHERE id = ?', [Number(m[1])]);
    if (!c) throw httpError(404, 'Pedido não encontrado.', 'not_found');
    if (c.status !== 'pendente') throw httpError(409, 'Este pedido já foi analisado.', 'claim_decided');
    const now = nowIso();
    if (m[2] === 'reject') {
      const reason = str(b.reason, 300) || 'Não foi possível confirmar que você é o responsável pelo estabelecimento.';
      db.run("UPDATE claims SET status = 'recusado', reason = ?, decided_at = ?, decided_by = ? WHERE id = ?", [reason, now, admin.id, c.id]);
      deletePhotosIfUnused(photoFiles(safeJson(c.data, {}).photos));
      return send(res, 200, { claim: claimView(db.get('SELECT * FROM claims WHERE id = ?', [c.id])) });
    }
    if (db.get('SELECT id FROM restaurants WHERE osm_ref = ?', [c.osm_ref])) throw httpError(409, 'Este restaurante já foi assumido.', 'already_claimed');
    const r = safeJson(c.data, {});
    const restaurantId = db.tx(() => {
      const id = db.run(
        `INSERT INTO restaurants (owner_id, osm_ref, ${FIELDS.join(', ')}, created_at, updated_at) VALUES (?, ?, ${FIELDS.map(() => '?').join(', ')}, ?, ?)`,
        [c.user_id, c.osm_ref, ...FIELDS.map(f => r[f] ?? ''), now, now]
      );
      db.run("UPDATE claims SET status = 'aprovado', restaurant_id = ?, decided_at = ?, decided_by = ? WHERE id = ?", [id, now, admin.id, c.id]);
      db.run("UPDATE claims SET status = 'recusado', reason = 'Outro pedido para este restaurante foi aprovado.', decided_at = ?, decided_by = ? WHERE osm_ref = ? AND status = 'pendente'", [now, admin.id, c.osm_ref]);
      return id;
    });
    return send(res, 200, { claim: claimView(db.get('SELECT * FROM claims WHERE id = ?', [c.id])), restaurantId: `ff-${restaurantId}` });
  }

  // Recuperação de senha sem e-mail: o administrador gera uma senha temporária.
  if (p === '/api/admin/users/reset-password' && method === 'POST') {
    requireAdmin(req);
    const b = await readBody(req);
    const email = str(b.email, 200).toLowerCase();
    const target = db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (!target) throw httpError(404, 'Nenhuma conta com este e-mail.', 'not_found');
    if (isAdmin(target)) throw httpError(400, 'Para a conta do administrador, use "Trocar senha" em Minha conta.', 'admin_account');
    const temporaryPassword = crypto.randomBytes(9).toString('base64url');
    const hash = await sec.hashPassword(temporaryPassword);
    db.tx(() => {
      db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [hash, nowIso(), target.id]);
      db.run('DELETE FROM sessions WHERE user_id = ?', [target.id]);
    });
    sec.limits.loginEmail.reset(email);
    return send(res, 200, { ok: true, email, temporaryPassword });
  }

  // ---------------- Campanhas (dono) ----------------
  if (p === '/api/my/campaigns' && method === 'GET') {
    const user = requireRestaurantUser(req);
    const rows = db.all(`SELECT c.*, r.name AS restaurant_name FROM campaigns c JOIN restaurants r ON r.id = c.restaurant_id
      WHERE r.owner_id = ? ORDER BY c.created_at DESC, c.id DESC`, [user.id]);
    return send(res, 200, { campaigns: rows.map(c => ownerCampaign(req, c)) });
  }

  if (p === '/api/my/campaigns' && method === 'POST') {
    const user = requireRestaurantUser(req);
    const b = await readBody(req);
    const restaurant = db.get('SELECT id, owner_id FROM restaurants WHERE id = ?', [Number(String(b.restaurantId).replace(/^ff-/, ''))]);
    if (!restaurant || restaurant.owner_id !== user.id) throw httpError(403, 'Selecione um restaurante cadastrado na sua conta.', 'not_owner');
    const c = cleanCampaign(b);
    const now = nowIso();
    let id;
    for (let i = 0; i < 5 && !id; i++) {
      const code = newCampaignCode();
      if (db.get('SELECT id FROM campaigns WHERE code = ?', [code])) continue;
      id = db.run(`INSERT INTO campaigns (restaurant_id, code, title, description, discount_type, discount_value, starts_at, ends_at, max_redemptions, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`, [restaurant.id, code, c.title, c.description, c.discountType, c.discountValue, c.startsAt, c.endsAt, c.maxRedemptions, now, now]);
    }
    return send(res, 201, { campaign: ownerCampaign(req, ownerCampaignRow(user, id)) });
  }

  m = p.match(/^\/api\/my\/campaigns\/(\d{1,9})(\/status|\/qr\.svg|\/vouchers|\/new-code)?$/);
  if (m) {
    const user = requireRestaurantUser(req);
    const c = ownerCampaignRow(user, m[1]);
    const sub = m[2] || '';

    if (!sub && method === 'GET') return send(res, 200, { campaign: ownerCampaign(req, c) });

    if (!sub && method === 'PUT') {
      const clean = cleanCampaign(await readBody(req), { usedNow: usedCount(c.id) });
      db.run(`UPDATE campaigns SET title = ?, description = ?, discount_type = ?, discount_value = ?, starts_at = ?, ends_at = ?, max_redemptions = ?, updated_at = ? WHERE id = ?`,
        [clean.title, clean.description, clean.discountType, clean.discountValue, clean.startsAt, clean.endsAt, clean.maxRedemptions, nowIso(), c.id]);
      return send(res, 200, { campaign: ownerCampaign(req, ownerCampaignRow(user, c.id)) });
    }

    if (!sub && method === 'DELETE') {
      const removed = usedCount(c.id);
      db.run('DELETE FROM campaigns WHERE id = ?', [c.id]); // resgates/vouchers apagados em cascata
      return send(res, 200, { ok: true, redemptionsRemoved: removed });
    }

    if (sub === '/status' && method === 'POST') {
      const b = await readBody(req);
      if (typeof b.active !== 'boolean') throw httpError(400, 'Informe active: true (ativar) ou false (pausar).', 'invalid_fields');
      db.run('UPDATE campaigns SET active = ?, updated_at = ? WHERE id = ?', [b.active ? 1 : 0, nowIso(), c.id]);
      return send(res, 200, { campaign: ownerCampaign(req, ownerCampaignRow(user, c.id)) });
    }

    if (sub === '/new-code' && method === 'POST') {
      let code;
      do { code = newCampaignCode(); } while (db.get('SELECT id FROM campaigns WHERE code = ?', [code]));
      db.run('UPDATE campaigns SET code = ?, updated_at = ? WHERE id = ?', [code, nowIso(), c.id]);
      return send(res, 200, { campaign: ownerCampaign(req, ownerCampaignRow(user, c.id)) });
    }

    if (sub === '/qr.svg' && method === 'GET') {
      const svg = await QRCode.toString(redeemUrl(req, c.code), { type: 'svg', margin: 2, errorCorrectionLevel: 'M', color: { dark: '#1a0808', light: '#ffffff' } });
      const headers = { 'Cache-Control': 'private, no-store' };
      if (u.searchParams.get('download') === '1') headers['Content-Disposition'] = `attachment; filename="foodfind-campanha-${c.id}-qrcode.svg"`;
      return send(res, 200, svg, 'image/svg+xml; charset=utf-8', headers);
    }

    if (sub === '/vouchers' && method === 'GET') {
      const rows = db.all(`${REDEMPTION_SELECT} WHERE x.campaign_id = ? ORDER BY x.redeemed_at DESC`, [c.id]);
      return send(res, 200, { vouchers: rows.map(x => voucherView(x, { forOwner: true })) });
    }
  }

  // ---------------- Vouchers (dono valida) ----------------
  m = p.match(/^\/api\/my\/vouchers\/([A-Za-z0-9-]{1,20})(\/use)?$/);
  if (m) {
    const user = requireRestaurantUser(req);
    if (!m[2] && method === 'GET') return send(res, 200, { voucher: voucherView(ownerVoucher(user, m[1]), { forOwner: true }) });
    if (m[2] && method === 'POST') {
      const wait = sec.limits.redeem.retryAfter(`voucher:${user.id}`);
      if (wait) throw tooMany(wait, 'Muitas tentativas de validação');
      const b = await readBody(req);
      const x = ownerVoucher(user, m[1]);
      if (str(b.checkCode, 20).toUpperCase().replace(/[^A-Z0-9]/g, '') !== x.check_code) {
        sec.limits.redeem.hit(`voucher:${user.id}`);
        throw httpError(400, 'O código de conferência não confere com o do voucher. Peça ao cliente para mostrar o comprovante.', 'voucher_check_mismatch');
      }
      if (x.status === 'usado') throw httpError(409, `Este voucher já foi usado em ${time.formatSaoPaulo(x.used_at)}.`, 'voucher_used');
      if (Date.now() > Date.parse(x.ends_at)) throw httpError(410, 'Este voucher expirou junto com a campanha.', 'voucher_expired');
      db.run("UPDATE redemptions SET status = 'usado', used_at = ? WHERE id = ? AND status = 'emitido'", [nowIso(), x.id]);
      if (!db.changes()) throw httpError(409, 'Este voucher já foi usado.', 'voucher_used');
      return send(res, 200, { ok: true, message: 'Voucher validado. Aplique o desconto ao cliente.', voucher: voucherView(ownerVoucher(user, m[1]), { forOwner: true }) });
    }
  }

  // ---------------- Resgate (cliente) ----------------
  if (p === '/api/campaigns/redeem' && method === 'POST') {
    const user = currentUser(req);
    if (!user) throw httpError(401, 'Entre na sua conta de cliente para resgatar a oferta.', 'auth_required');
    if (user.role !== 'cliente') throw httpError(403, 'Somente contas do tipo Cliente podem resgatar ofertas.', 'not_client');
    const b = await readBody(req);
    const code = normalizeCode(b.code);
    if (!code) throw httpError(400, 'Informe ou leia o código do QR Code.', 'missing_code');
    const key = `user:${user.id}`;
    const wait = sec.limits.redeem.retryAfter(key);
    if (wait) throw tooMany(wait, 'Muitos códigos inválidos');
    const campaign = db.get('SELECT c.*, r.name AS restaurant_name FROM campaigns c JOIN restaurants r ON r.id = c.restaurant_id WHERE c.code = ?', [code]);
    if (!campaign) {
      sec.limits.redeem.hit(key);
      throw httpError(404, 'Código inválido. Confira o código ou leia o QR Code novamente.', 'invalid_code');
    }
    const now = Date.now();
    const when = iso => time.formatSaoPaulo(iso);
    if (now > Date.parse(campaign.ends_at)) throw httpError(410, `Esta campanha foi encerrada em ${when(campaign.ends_at)}.`, 'campaign_ended');
    if (!campaign.active) throw httpError(423, 'Esta campanha está pausada pelo restaurante no momento.', 'campaign_paused');
    if (now < Date.parse(campaign.starts_at)) throw httpError(409, `Esta campanha ainda não começou. Ela começa em ${when(campaign.starts_at)}.`, 'campaign_not_started');
    if (db.get('SELECT id FROM redemptions WHERE campaign_id = ? AND user_id = ?', [campaign.id, user.id])) throw httpError(409, 'Você já resgatou esta campanha. Veja o voucher em "Meus benefícios".', 'already_redeemed');
    let id;
    try {
      id = db.tx(() => {
        if (campaign.max_redemptions != null && usedCount(campaign.id) >= campaign.max_redemptions) {
          throw httpError(409, 'Esta campanha atingiu o limite de resgates.', 'campaign_sold_out');
        }
        return db.run('INSERT INTO redemptions (campaign_id, user_id, check_code, status, redeemed_at) VALUES (?, ?, ?, ?, ?)',
          [campaign.id, user.id, db.randomCheckCode(), 'emitido', nowIso()]);
      });
    } catch (e) {
      if (/UNIQUE/.test(e.message)) throw httpError(409, 'Você já resgatou esta campanha.', 'already_redeemed');
      throw e;
    }
    const voucher = voucherView(db.get(`${REDEMPTION_SELECT} WHERE x.id = ?`, [id]));
    return send(res, 201, { ok: true, message: 'Oferta resgatada com sucesso!', restaurantName: campaign.restaurant_name, voucher });
  }

  // ---------------- Diversos ----------------
  if (p === '/api/map-check' && method === 'GET') {
    if (!IS_DEV) requireAdmin(req);
    return send(res, 200, await mapCheck());
  }

  if (p === '/api/health' && method === 'GET') return send(res, 200, { ok: true, version: VERSION });

  throw httpError(404, 'Rota não encontrada.', 'not_found');
}

// ----------------------------------------------------------------------------
// Geocodificação (Nominatim) com cache
// ----------------------------------------------------------------------------
const geocodeCache = new Map();

async function geocode(q) {
  const key = normalizeName(q);
  const hit = geocodeCache.get(key);
  if (hit && Date.now() - hit.at < 24 * 3600 * 1000) return hit.results;
  const base = process.env.FOODFIND_NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search';
  let data;
  try {
    const r = await fetch(`${base}?format=json&limit=5&countrycodes=br&accept-language=pt-BR&q=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': `FoodFind/${VERSION} (projeto academico FATEC Ipiranga)` },
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) throw new Error(`Nominatim HTTP ${r.status}`);
    data = await r.json();
  } catch (e) {
    sec.logError('Geocodificação', e);
    throw httpError(502, 'Não foi possível buscar o endereço agora. Tente novamente em instantes.', 'geocode_unavailable');
  }
  const results = (Array.isArray(data) ? data : []).map(d => ({ label: str(d.display_name, 300), lat: Number(d.lat), lng: Number(d.lon) }))
    .filter(d => d.label && Number.isFinite(d.lat) && Number.isFinite(d.lng));
  geocodeCache.set(key, { at: Date.now(), results });
  if (geocodeCache.size > 500) geocodeCache.delete(geocodeCache.keys().next().value);
  return results;
}

// ----------------------------------------------------------------------------
// Tiles do mapa (último recurso quando os servidores de mapa são bloqueados na rede do usuário)
// ----------------------------------------------------------------------------
const tileCache = new Map();
const TILE_SOURCES = [
  { name: 'OpenStreetMap', url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png` },
  { name: 'Esri', url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}` }
];
const TILE_HEADERS = { 'User-Agent': `FoodFind/${VERSION} (projeto academico FATEC Ipiranga)` };

async function fetchTile(src, z, x, y) {
  const r = await fetch(src.url(z, x, y), { headers: TILE_HEADERS, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const type = r.headers.get('content-type') || 'image/png';
  if (!/^image\/(png|jpeg)/.test(type)) throw new Error('tipo inesperado');
  return { body: Buffer.from(await r.arrayBuffer()), type };
}

async function sendTile(req, res, z, x, y) {
  if (!sec.isSameSite(req)) throw httpError(403, 'Mapa disponível apenas dentro do FoodFind.', 'bad_origin');
  const wait = sec.limits.tiles.consume(sec.clientIp(req));
  if (wait) throw tooMany(wait, 'Muitas requisições de mapa');
  z = Number(z); x = Number(x); y = Number(y);
  if (z > 19 || x >= 2 ** z || y >= 2 ** z) throw httpError(404, 'Tile inexistente.', 'not_found');
  const key = `${z}/${x}/${y}`;
  let tile = tileCache.get(key);
  if (!tile) {
    for (const src of TILE_SOURCES) {
      try { tile = await fetchTile(src, z, x, y); break; }
      catch (e) { console.warn(`Mapa (${src.name}): ${e.cause?.code || e.message}`); }
    }
    if (!tile) return send(res, 502, 'Mapa indisponível', 'text/plain; charset=utf-8');
    if (tileCache.size > 3000) tileCache.delete(tileCache.keys().next().value);
    tileCache.set(key, tile);
  }
  send(res, 200, tile.body, tile.type, { 'Cache-Control': 'public, max-age=86400' });
}

async function mapCheck() {
  const results = [];
  for (const src of TILE_SOURCES) {
    const t0 = Date.now();
    try {
      const t = await fetchTile(src, 14, 6069, 9294);
      results.push({ servidor: src.name, ok: true, tempo_ms: Date.now() - t0, tipo: t.type });
    } catch (e) {
      results.push({ servidor: src.name, ok: false, tempo_ms: Date.now() - t0, erro: e.name === 'TimeoutError' ? 'sem resposta em 8s' : (e.cause?.code || e.message) });
    }
  }
  return {
    node: process.version,
    proxy_configurado: Boolean(process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy),
    resultados: results,
    overpass: await osm.checkOverpass()
  };
}

// ----------------------------------------------------------------------------
// Servidor
// ----------------------------------------------------------------------------
async function server(req, res) {
  sec.securityHeaders(req, res);
  let u;
  try { u = new URL(req.url, 'http://localhost'); }
  catch { return send(res, 400, { message: 'Endereço inválido.' }); }
  try {
    if (u.pathname.startsWith('/api/')) return await api(req, res, u);
    if (!['GET', 'HEAD'].includes(req.method)) throw httpError(405, 'Método não permitido.', 'method_not_allowed');

    const tile = u.pathname.match(/^\/tiles\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})(\.png)?$/);
    if (tile) return await sendTile(req, res, tile[1], tile[2], tile[3]);

    const up = u.pathname.match(/^\/uploads\/([a-f0-9-]{36}\.(jpg|png|webp))$/);
    if (up) {
      const file = path.join(db.UPLOAD_DIR, up[1]);
      try { return await sendFile(req, res, file, { 'Cache-Control': 'public, max-age=31536000, immutable' }); }
      catch { return send(res, 404, 'Não encontrado', 'text/plain; charset=utf-8'); }
    }

    let rel;
    try { rel = decodeURIComponent(u.pathname); } catch { throw httpError(400, 'Endereço inválido.', 'bad_path'); }
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.resolve(root, `.${rel}`);
    if (!file.startsWith(root + path.sep)) throw httpError(404, 'Não encontrado.', 'not_found');
    const headers = { 'Cache-Control': 'no-cache' };
    if (rel === '/sw.js') headers['Service-Worker-Allowed'] = '/';
    try {
      const st = await fs.promises.stat(file);
      if (st.isFile()) return await sendFile(req, res, file, headers);
    } catch { /* cai no tratamento abaixo */ }
    // Caminhos sem extensão são rotas do app (SPA); arquivos inexistentes dão 404.
    if (!path.extname(rel)) return await sendFile(req, res, path.join(root, 'index.html'), headers);
    return send(res, 404, 'Não encontrado', 'text/plain; charset=utf-8');
  } catch (e) {
    if (!e.status) sec.logError(`${req.method} ${u.pathname}`, e);
    const headers = e.retryAfter ? { 'Retry-After': String(e.retryAfter) } : {};
    if (res.headersSent) { res.end(); return; }
    send(res, e.status || 500, { message: e.status ? e.message : 'Erro interno. Tente novamente.', code: e.code || (e.status ? undefined : 'internal_error') }, undefined, headers);
  }
}

process.on('uncaughtException', e => sec.logError('Exceção não tratada', e));
process.on('unhandledRejection', e => sec.logError('Promessa rejeitada sem tratamento', e));

async function start() {
  const info = await db.init();
  osm.setCacheFile(path.join(info.DATA_DIR, 'osm-cache.json'));
  db.acquireLock();
  await ensureAdminAccount();
  const maintenance = setInterval(() => {
    try {
      if (db.cleanExpiredSessions()) db.save();
      cleanOrphanUploads();
      Object.values(sec.limits).forEach(l => l.sweep());
    } catch (e) { sec.logError('Manutenção', e); }
  }, 60 * 60 * 1000);
  maintenance.unref();
  const srv = http.createServer(server);
  srv.headersTimeout = 20000;
  srv.requestTimeout = 60000;
  await new Promise(resolve => srv.listen(PORT, HOST, resolve));
  const port = srv.address().port;
  console.log(`FoodFind ${VERSION} em http://localhost:${port} (dados em ${info.DATA_DIR})`);
  // Encerramento limpo (docker stop envia SIGTERM): para de aceitar conexões e libera a trava.
  const shutdown = signal => {
    console.log(`Recebido ${signal}; encerrando o FoodFind.`);
    db.releaseLock();
    srv.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  return srv;
}

if (require.main === module) {
  start().catch(e => {
    sec.logError('Não foi possível iniciar o FoodFind', e);
    process.exit(1);
  });
}

module.exports = { start, normalizeCode, newCampaignCode, abbreviateName, campaignStatus, detectImage };
