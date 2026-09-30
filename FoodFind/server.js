const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const root = path.join(__dirname, 'public');
const DEFAULT_LOCATION = { lat: -23.5613, lng: -46.6565 };
const SEARCH_RADIUS_KM = 4;
const SESSION_DAYS = 30;
const MAX_RESULTS = 300;

const CATEGORIES = ['Restaurante', 'Café', 'Fast-food', 'Bar', 'Pizzaria', 'Lanchonete', 'Padaria', 'Sorveteria', 'Doceria', 'Outro'];
const PRICE_RANGES = ['', '$', '$$', '$$$', '$$$$'];
const DAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];

function send(res, code, data, type = 'application/json; charset=utf-8', extraHeaders = {}) {
  res.writeHead(code, { 'Content-Type': type, ...extraHeaders });
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const p = Math.PI / 180;
  const a = 0.5 - Math.cos((lat2 - lat1) * p) / 2 + Math.cos(lat1 * p) * Math.cos(lat2 * p) * (1 - Math.cos((lon2 - lon1) * p)) / 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function formatDistance(km) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1).replace('.', ',')} km`;
}

function normalizeName(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Arquivo ou dados grandes demais.'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(Object.assign(new Error('JSON inválido.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function checkPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const original = Buffer.from(hash, 'hex');
  return original.length === test.length && crypto.timingSafeEqual(original, test);
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

function sessionCookie(token, maxAgeSeconds) {
  return `ff_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function publicUser(u) {
  return u ? { id: u.id, name: u.name, email: u.email, role: u.role } : null;
}

function currentUser(req) {
  const token = parseCookies(req).ff_session;
  if (!token) return null;
  return db.get(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?`, [token, Date.now()]);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', [token, userId, Date.now() + SESSION_DAYS * 86400000]);
  return sessionCookie(token, SESSION_DAYS * 86400);
}

function requireRestaurantUser(req) {
  const user = currentUser(req);
  if (!user) throw httpError(401, 'Faça login para continuar.');
  if (user.role !== 'restaurante') throw httpError(403, 'Apenas contas do tipo Restaurante podem gerenciar restaurantes.');
  return user;
}

function str(v, max = 300) { return String(v ?? '').trim().slice(0, max); }

function cleanUrl(v) {
  const s = str(v, 500);
  if (!s) return '';
  const full = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(full);
    return ['http:', 'https:'].includes(u.protocol) && u.hostname.includes('.') ? u.href : '';
  } catch { return ''; }
}

function cleanInstagram(v) {
  const s = str(v, 200);
  if (!s) return '';
  if (/instagram\.com/i.test(s)) return cleanUrl(s);
  const handle = s.replace(/^@/, '').replace(/[^A-Za-z0-9._]/g, '');
  return handle ? `https://instagram.com/${handle}` : '';
}

function cleanTime(v) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v)) ? String(v) : ''; }

function cleanHours(h) {
  const out = {};
  for (const d of DAYS) {
    const day = (h && h[d]) || {};
    const open = cleanTime(day.open), close = cleanTime(day.close);
    out[d] = { closed: Boolean(day.closed) || !open || !close, open, close };
  }
  return out;
}

function cleanMenu(menu) {
  if (!Array.isArray(menu)) return [];
  return menu.slice(0, 300).map(item => {
    const priceNum = Number(String(item.price ?? '').replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
    return {
      section: str(item.section, 60) || 'Pratos',
      name: str(item.name, 120),
      description: str(item.description, 400),
      price: Number.isFinite(priceNum) && priceNum > 0 ? Math.round(priceNum * 100) / 100 : null
    };
  }).filter(i => i.name);
}

function cleanPhotos(photos) {
  if (!Array.isArray(photos)) return [];
  return [...new Set(photos)].filter(p => /^\/uploads\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(p)).slice(0, 12);
}

function cleanRestaurant(b) {
  const lat = Number(b.lat), lng = Number(b.lng);
  const r = {
    name: str(b.name, 120),
    category: CATEGORIES.includes(b.category) ? b.category : 'Restaurante',
    cuisine: str(b.cuisine, 120),
    description: str(b.description, 1500),
    website: cleanUrl(b.website),
    phone: str(b.phone, 40),
    whatsapp: str(b.whatsapp, 30).replace(/\D/g, ''),
    instagram: cleanInstagram(b.instagram),
    delivery_url: cleanUrl(b.deliveryUrl),
    menu_url: cleanUrl(b.menuUrl),
    price_range: PRICE_RANGES.includes(b.priceRange) ? b.priceRange : '',
    address: str(b.address, 300),
    lat, lng,
    hours: JSON.stringify(cleanHours(b.hours)),
    menu: JSON.stringify(cleanMenu(b.menu)),
    photos: JSON.stringify(cleanPhotos(b.photos))
  };
  if (!r.name) throw httpError(400, 'Informe o nome do restaurante.');
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
    throw httpError(400, 'Defina a localização do restaurante no mapa.');
  }
  if (str(b.website) && !r.website) throw httpError(400, 'A URL do site não é válida. Ex.: https://meurestaurante.com.br');
  return r;
}

const FIELDS = ['name', 'category', 'cuisine', 'description', 'website', 'phone', 'whatsapp', 'instagram', 'delivery_url', 'menu_url', 'price_range', 'address', 'lat', 'lng', 'hours', 'menu', 'photos'];

function editableRestaurant(row) {
  return {
    id: row.id, osmRef: row.osm_ref, name: row.name, category: row.category, cuisine: row.cuisine,
    description: row.description, website: row.website, phone: row.phone, whatsapp: row.whatsapp,
    instagram: row.instagram, deliveryUrl: row.delivery_url, menuUrl: row.menu_url, priceRange: row.price_range,
    address: row.address, lat: row.lat, lng: row.lng,
    hours: JSON.parse(row.hours || '{}'), menu: JSON.parse(row.menu || '[]'), photos: JSON.parse(row.photos || '[]'),
    publicId: `ff-${row.id}`, updatedAt: row.updated_at
  };
}

function publicRestaurant(row, center) {
  const photos = JSON.parse(row.photos || '[]');
  const km = center ? haversine(center.lat, center.lng, row.lat, row.lng) : null;
  return {
    id: `ff-${row.id}`,
    registered: true,
    ownerId: row.owner_id,
    osmRef: row.osm_ref,
    name: row.name,
    category: row.category || 'Restaurante',
    cuisine: row.cuisine || '',
    rating: null,
    distanceKm: km,
    distance: km == null ? '' : formatDistance(km),
    address: row.address || 'Endereço não informado',
    phone: row.phone || 'Telefone não informado',
    whatsapp: row.whatsapp || '',
    instagram: row.instagram || '',
    deliveryUrl: row.delivery_url || '',
    menuUrl: row.menu_url || '',
    priceRange: row.price_range || '',
    schedule: JSON.parse(row.hours || '{}'),
    hours: 'Veja os horários no perfil',
    description: row.description || (row.cuisine ? `Culinária: ${row.cuisine}.` : 'Restaurante cadastrado no FoodFind.'),
    menu: JSON.parse(row.menu || '[]'),
    website: row.website || '',
    photos,
    image: photos[0] || '',
    lat: row.lat,
    lng: row.lng,
    updatedAt: row.updated_at
  };
}

const osmCache = new Map();

async function fetchOsmRestaurants(lat, lng) {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const cached = osmCache.get(key);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.data;

  const query = `
    [out:json][timeout:20];
    (
      nwr[amenity~"restaurant|fast_food|cafe"](around:${SEARCH_RADIUS_KM * 1000},${lat},${lng});
    );
    out center tags;
  `;
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'User-Agent': 'FoodFind/2.2' },
    body: query
  });
  if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
  const data = await response.json();
  const list = data.elements.map(el => {
    const t = el.tags || {};
    const rlat = Number(el.lat ?? el.center?.lat);
    const rlng = Number(el.lon ?? el.center?.lon);
    const rating = t.stars ? Number(t.stars) : null;
    return {
      id: `${el.type}-${el.id}`,
      registered: false,
      name: t.name || t['name:pt'] || 'Restaurante sem nome',
      category: t.amenity === 'cafe' ? 'Café' : t.amenity === 'fast_food' ? 'Fast-food' : 'Restaurante',
      cuisine: t.cuisine ? t.cuisine.replaceAll(';', ', ') : '',
      rating: Number.isFinite(rating) ? rating : null,
      address: [t['addr:street'], t['addr:housenumber'], t['addr:neighbourhood'], t['addr:city']].filter(Boolean).join(', ') || 'Endereço não informado',
      phone: t.phone || t['contact:phone'] || 'Telefone não informado',
      hours: t.opening_hours || 'Horário não informado',
      description: t.cuisine ? `Culinária: ${t.cuisine.replaceAll(';', ', ')}.` : 'Estabelecimento encontrado no OpenStreetMap.',
      website: t.website || t['contact:website'] || '',
      lat: rlat, lng: rlng,
      image: ''
    };
  }).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng));
  osmCache.set(key, { at: Date.now(), data: list });
  return list;
}

async function searchRestaurants(lat, lng, q) {
  let osm = [], warning = '';
  try { osm = await fetchOsmRestaurants(lat, lng); }
  catch (e) { console.error(e); warning = 'O OpenStreetMap não respondeu agora; mostrando apenas os restaurantes cadastrados no FoodFind.'; }

  const registered = db.all('SELECT * FROM restaurants');
  const linkedRefs = new Set(registered.map(r => r.osm_ref).filter(Boolean));
  const center = { lat, lng };

  const list = osm.filter(o => {
    if (linkedRefs.has(o.id)) return false;
    const n = normalizeName(o.name);
    return !registered.some(r => !r.osm_ref && normalizeName(r.name) === n && haversine(r.lat, r.lng, o.lat, o.lng) < 0.15);
  }).map(o => {
    const km = haversine(lat, lng, o.lat, o.lng);
    return { ...o, distanceKm: km, distance: formatDistance(km) };
  });

  for (const r of registered) {
    if (haversine(lat, lng, r.lat, r.lng) <= SEARCH_RADIUS_KM) list.push(publicRestaurant(r, center));
  }

  const term = normalizeName(q);
  const filtered = term ? list.filter(r => {
    const text = [r.name, r.category, r.cuisine, r.description, ...(r.menu || []).map(m => `${m.name} ${m.section}`)].join(' ');
    return normalizeName(text).includes(term);
  }) : list;

  filtered.sort((a, b) => a.distanceKm - b.distanceKm);
  return { restaurants: filtered.slice(0, MAX_RESULTS), warning };
}

async function api(req, res, u) {
  const method = req.method;
  const p = u.pathname;

  if (p === '/api/auth/register' && method === 'POST') {
    const b = await readBody(req);
    const name = str(b.name, 100);
    const email = str(b.email, 200).toLowerCase();
    const password = String(b.password || '');
    const role = b.role === 'restaurante' ? 'restaurante' : 'cliente';
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, 'Preencha nome e um e-mail válido.');
    if (password.length < 6) throw httpError(400, 'A senha precisa ter pelo menos 6 caracteres.');
    if (db.get('SELECT id FROM users WHERE email = ?', [email])) throw httpError(409, 'Este e-mail já está cadastrado. Por favor, faça login.');
    const id = db.run('INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)', [name, email, hashPassword(password), role, new Date().toISOString()]);
    const user = db.get('SELECT * FROM users WHERE id = ?', [id]);
    return send(res, 201, { user: publicUser(user) }, undefined, { 'Set-Cookie': createSession(id) });
  }

  if (p === '/api/auth/login' && method === 'POST') {
    const b = await readBody(req);
    const email = str(b.email, 200).toLowerCase();
    const user = db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) return send(res, 404, { code: 'no_account', message: 'E-mail não cadastrado. É necessário criar uma conta primeiro.' });
    if (!checkPassword(String(b.password || ''), user.password_hash)) throw httpError(401, 'Senha incorreta. Tente novamente.');
    return send(res, 200, { user: publicUser(user) }, undefined, { 'Set-Cookie': createSession(user.id) });
  }

  if (p === '/api/auth/logout' && method === 'POST') {
    const token = parseCookies(req).ff_session;
    if (token) db.run('DELETE FROM sessions WHERE token = ?', [token]);
    return send(res, 200, { ok: true }, undefined, { 'Set-Cookie': sessionCookie('', 0) });
  }

  if (p === '/api/auth/me' && method === 'GET') {
    return send(res, 200, { user: publicUser(currentUser(req)) });
  }

  if (p === '/api/restaurants' && method === 'GET') {
    const lat = Number(u.searchParams.get('lat')) || DEFAULT_LOCATION.lat;
    const lng = Number(u.searchParams.get('lng')) || DEFAULT_LOCATION.lng;
    const q = u.searchParams.get('q') || '';
    const { restaurants, warning } = await searchRestaurants(lat, lng, q);
    return send(res, 200, { source: 'OpenStreetMap + FoodFind', center: { lat, lng }, restaurants, warning });
  }

  let m = p.match(/^\/api\/restaurants\/ff-(\d+)$/);
  if (m && method === 'GET') {
    const row = db.get('SELECT * FROM restaurants WHERE id = ?', [Number(m[1])]);
    if (!row) throw httpError(404, 'Restaurante não encontrado.');
    const lat = Number(u.searchParams.get('lat')), lng = Number(u.searchParams.get('lng'));
    return send(res, 200, { restaurant: publicRestaurant(row, Number.isFinite(lat) && lat ? { lat, lng } : null) });
  }

  if (p === '/api/geocode' && method === 'GET') {
    const q = str(u.searchParams.get('q'), 200);
    if (q.length < 3) return send(res, 200, { results: [] });
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=br&accept-language=pt-BR&q=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': 'FoodFind/2.2 (projeto academico)' }
    });
    if (!r.ok) throw httpError(502, 'Não foi possível buscar o endereço agora.');
    const data = await r.json();
    return send(res, 200, { results: data.map(d => ({ label: d.display_name, lat: Number(d.lat), lng: Number(d.lon) })) });
  }

  if (p === '/api/my/restaurants' && method === 'GET') {
    const user = requireRestaurantUser(req);
    const rows = db.all('SELECT * FROM restaurants WHERE owner_id = ? ORDER BY updated_at DESC', [user.id]);
    return send(res, 200, { restaurants: rows.map(editableRestaurant) });
  }

  if (p === '/api/my/restaurants' && method === 'POST') {
    const user = requireRestaurantUser(req);
    const b = await readBody(req);
    const r = cleanRestaurant(b);
    let osmRef = null;
    if (b.osmRef) {
      if (!/^(node|way|relation)-\d+$/.test(b.osmRef)) throw httpError(400, 'Vínculo com restaurante inválido.');
      const taken = db.get('SELECT owner_id FROM restaurants WHERE osm_ref = ?', [b.osmRef]);
      if (taken) throw httpError(409, taken.owner_id === user.id ? 'Você já cadastrou este restaurante. Edite-o na sua lista.' : 'Este restaurante já foi assumido por outra conta.');
      osmRef = b.osmRef;
    }
    const now = new Date().toISOString();
    const id = db.run(
      `INSERT INTO restaurants (owner_id, osm_ref, ${FIELDS.join(', ')}, created_at, updated_at) VALUES (?, ?, ${FIELDS.map(() => '?').join(', ')}, ?, ?)`,
      [user.id, osmRef, ...FIELDS.map(f => r[f]), now, now]
    );
    return send(res, 201, { restaurant: editableRestaurant(db.get('SELECT * FROM restaurants WHERE id = ?', [id])) });
  }

  m = p.match(/^\/api\/my\/restaurants\/(\d+)$/);
  if (m && (method === 'PUT' || method === 'DELETE')) {
    const user = requireRestaurantUser(req);
    const id = Number(m[1]);
    const row = db.get('SELECT * FROM restaurants WHERE id = ?', [id]);
    if (!row || row.owner_id !== user.id) throw httpError(404, 'Restaurante não encontrado na sua conta.');
    if (method === 'DELETE') {
      db.run('DELETE FROM restaurants WHERE id = ?', [id]);
      return send(res, 200, { ok: true });
    }
    const r = cleanRestaurant(await readBody(req));
    db.run(`UPDATE restaurants SET ${FIELDS.map(f => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [...FIELDS.map(f => r[f]), new Date().toISOString(), id]);
    return send(res, 200, { restaurant: editableRestaurant(db.get('SELECT * FROM restaurants WHERE id = ?', [id])) });
  }

  if (p === '/api/uploads' && method === 'POST') {
    requireRestaurantUser(req);
    const b = await readBody(req, 8 * 1024 * 1024);
    const match = String(b.dataUrl || '').match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw httpError(400, 'Envie uma imagem JPG, PNG ou WEBP.');
    const buf = Buffer.from(match[2], 'base64');
    if (buf.length > 5 * 1024 * 1024) throw httpError(413, 'A imagem deve ter no máximo 5 MB.');
    const file = `${crypto.randomUUID()}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`;
    fs.writeFileSync(path.join(db.UPLOAD_DIR, file), buf);
    return send(res, 201, { url: `/uploads/${file}` });
  }

  if (p === '/api/map-check') return send(res, 200, await mapCheck());

  if (p === '/api/health') return send(res, 200, { ok: true });

  throw httpError(404, 'Rota não encontrada.');
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon'
};

const tileCache = new Map();
const TILE_SOURCES = [
  { name: 'OpenStreetMap', url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png` },
  { name: 'CARTO', url: (z, x, y) => `https://a.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png` },
  { name: 'Esri', url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}` }
];
const TILE_HEADERS = { 'User-Agent': 'FoodFind/2.3 (projeto academico)', 'Referer': 'http://localhost/' };

async function fetchTile(src, z, x, y) {
  const r = await fetch(src.url(z, x, y), { headers: TILE_HEADERS, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return { body: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') || 'image/png' };
}

async function sendTile(res, z, x, y) {
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
    resultados: results
  };
}

async function server(req, res) {
  const u = new URL(req.url, 'http://localhost');
  try {
    if (u.pathname.startsWith('/api/')) return await api(req, res, u);

    const tile = u.pathname.match(/^\/tiles\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})(\.png)?$/);
    if (tile) return await sendTile(res, tile[1], tile[2], tile[3]);

    const up = u.pathname.match(/^\/uploads\/([a-f0-9-]{36}\.(jpg|png|webp))$/);
    if (up) {
      const file = path.join(db.UPLOAD_DIR, up[1]);
      if (!fs.existsSync(file)) return send(res, 404, 'Não encontrado', 'text/plain; charset=utf-8');
      return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)], { 'Cache-Control': 'public, max-age=31536000, immutable' });
    }

    let p = path.join(root, u.pathname === '/' ? 'index.html' : u.pathname);
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(root, 'index.html');
    send(res, 200, fs.readFileSync(p), TYPES[path.extname(p)] || 'application/octet-stream', { 'Cache-Control': 'no-cache' });
  } catch (e) {
    if (!e.status) console.error(e);
    send(res, e.status || 500, { message: e.status ? e.message : 'Erro interno.' });
  }
}

db.init().then(() => {
  http.createServer(server).listen(PORT, () => console.log(`FoodFind em http://localhost:${PORT}`));
}).catch(e => {
  console.error('Não foi possível abrir o banco de dados:', e);
  process.exit(1);
});