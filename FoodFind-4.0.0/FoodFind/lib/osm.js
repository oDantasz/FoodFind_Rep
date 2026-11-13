// Integração com o OpenStreetMap (Overpass API).
// Todo dado externo passa pelas funções de limpeza antes de chegar ao front-end.
const fs = require('fs');
const { cleanUrl, cleanInstagram, cleanPhone, str } = require('./validate');
const { DAY_KEYS, nowInSaoPaulo } = require('./time');

const OSM_REF = /^(node|way|relation)-(\d{1,15})$/;
const CACHE_MS = 5 * 60 * 1000;
const searchCache = new Map();
const known = new Map(); // lugares vistos recentemente: ref -> lugar

// Servidores Overpass. O principal costuma ficar sobrecarregado e às vezes responde
// 200 com "remark" de erro e nenhum resultado; nesse caso tentamos os espelhos públicos.
// FOODFIND_OVERPASS_URL: um ou mais endereços separados por vírgula, tentados em ordem.
// Em hospedagens de nuvem (Render), os servidores públicos costumam bloquear o IP; use um
// serviço com chave gratuita, ex.: https://api.overpass.ch/v1/SUA_CHAVE/interpreter.
// O log mostra só o nome do servidor, nunca o caminho (onde fica a chave).
function overpassUrls() {
  if (process.env.FOODFIND_OVERPASS_URL) return process.env.FOODFIND_OVERPASS_URL.split(',').map(s => s.trim()).filter(Boolean);
  // Instâncias públicas listadas na wiki do OpenStreetMap (nov/2026). O kumi.systems saiu da lista.
  // O private.coffee vem primeiro porque não tem limite por IP; o overpass-api.de (FOSSGIS) é o
  // principal, mas vive sobrecarregado e limita IPs compartilhados de hospedagens como o Render.
  return [
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass-api.de/api/interpreter'
  ];
}

function remember(place) {
  if (known.has(place.id)) known.delete(place.id);
  known.set(place.id, place);
  if (known.size > 5000) known.delete(known.keys().next().value);
}

function categoryOf(t) {
  const cuisine = String(t.cuisine || '').toLowerCase();
  if (t.amenity === 'ice_cream' || t.shop === 'ice_cream') return 'Sorveteria';
  if (t.shop === 'bakery') return 'Padaria';
  if (t.shop === 'confectionery' || t.shop === 'pastry') return 'Doceria';
  if (['bar', 'pub', 'biergarten'].includes(t.amenity)) return 'Bar';
  if (t.amenity === 'cafe') return 'Café';
  if (cuisine.includes('pizza')) return 'Pizzaria';
  if (t.amenity === 'fast_food') return /burger|sandwich|hot_dog/.test(cuisine) ? 'Lanchonete' : 'Fast-food';
  return 'Restaurante';
}

// ---- opening_hours (subconjunto mais comum do formato do OSM) ----
const OSM_DAYS = { Mo: 'seg', Tu: 'ter', We: 'qua', Th: 'qui', Fr: 'sex', Sa: 'sab', Su: 'dom' };
const ORDER = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];

function parseDays(spec) {
  const days = new Set();
  for (const part of spec.split(',')) {
    const range = /^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/.exec(part.trim());
    if (!range) return null;
    const a = ORDER.indexOf(OSM_DAYS[range[1]]);
    const b = range[2] ? ORDER.indexOf(OSM_DAYS[range[2]]) : a;
    for (let i = a; ; i = (i + 1) % 7) { days.add(ORDER[i]); if (i === b) break; }
  }
  return days;
}

function parseTimes(spec) {
  const out = [];
  for (const part of spec.split(',')) {
    const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})\+?$/.exec(part.trim());
    if (!m) return null;
    const start = Number(m[1]) * 60 + Number(m[2]);
    let end = Number(m[3]) * 60 + Number(m[4]);
    if (start > 24 * 60 || end > 48 * 60) return null;
    if (end <= start) end += 24 * 60; // passa da meia-noite
    out.push([start, end]);
  }
  return out;
}

// Devolve { seg: [[ini, fim], ...], ... } ou null quando o formato não é reconhecido.
function parseOpeningHours(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  const week = Object.fromEntries(ORDER.map(d => [d, []]));
  if (s === '24/7') { for (const d of ORDER) week[d] = [[0, 24 * 60]]; return week; }
  for (const raw of s.split(';')) {
    const rule = raw.trim();
    if (!rule) continue;
    if (/^PH\b/.test(rule)) continue; // feriados: ignorados
    const m = /^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)?\s*(.*)$/.exec(rule);
    const days = m[1] ? parseDays(m[1]) : new Set(ORDER);
    if (!days) return null;
    const rest = m[2].trim();
    let times;
    if (/^(off|closed)$/i.test(rest)) times = [];
    else if (rest === '24/7' || rest === '00:00-24:00') times = [[0, 24 * 60]];
    else times = parseTimes(rest);
    if (!times) return null;
    for (const d of days) week[d] = times;
  }
  return week;
}

function isOpenByOsm(week, date = new Date()) {
  if (!week) return null;
  const now = nowInSaoPaulo(date);
  const today = week[now.dayKey] || [];
  if (today.some(([a, b]) => now.minutes >= a && now.minutes < b)) return true;
  const yesterday = week[DAY_KEYS[(now.dayIndex + 6) % 7]] || [];
  return yesterday.some(([, b]) => b > 24 * 60 && now.minutes < b - 24 * 60);
}

function parseElement(el) {
  const t = el.tags || {};
  const lat = Number(el.lat ?? el.center?.lat);
  const lng = Number(el.lon ?? el.center?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !['node', 'way', 'relation'].includes(el.type)) return null;
  const cuisine = t.cuisine ? str(t.cuisine.replaceAll(';', ', ').replaceAll('_', ' '), 120) : '';
  const hoursText = str(t.opening_hours, 200);
  return {
    id: `${el.type}-${Number(el.id)}`,
    registered: false,
    name: str(t.name || t['name:pt'], 120) || 'Estabelecimento sem nome',
    category: categoryOf(t),
    cuisine,
    address: [t['addr:street'], t['addr:housenumber'], t['addr:suburb'] || t['addr:neighbourhood'], t['addr:city']].filter(Boolean).map(x => str(x, 80)).join(', ') || 'Endereço não informado',
    phone: cleanPhone(t.phone || t['contact:phone']) || 'Telefone não informado',
    website: cleanUrl(t.website || t['contact:website'] || t.url),
    instagram: cleanInstagram(t['contact:instagram']),
    hours: hoursText || 'Horário não informado',
    openingHours: parseOpeningHours(hoursText),
    description: cuisine ? `Culinária: ${cuisine}.` : 'Estabelecimento encontrado no OpenStreetMap.',
    priceRange: '',
    lat, lng,
    image: '',
    photos: [],
    menu: []
  };
}

async function overpassOnce(url, query, timeoutMs = 30000) {
  // Consulta enviada como texto puro no corpo, igual à Sprint 3 (formato aceito por todos os espelhos).
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'User-Agent': 'FoodFind/4.0 (projeto academico FATEC Ipiranga; +https://github.com/oDantasz/FoodFind_Rep)' },
    body: query,
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!data || !Array.isArray(data.elements)) throw new Error('resposta inválida');
  // Erro de execução (servidor ocupado, tempo esgotado) vem com status 200 e "remark".
  if (data.remark && /error|timeout|timed out|too busy|rate_limited|out of memory/i.test(data.remark)) {
    throw new Error(`remark: ${String(data.remark).slice(0, 120)}`);
  }
  return data.elements.map(parseElement).filter(Boolean);
}

async function overpass(query) {
  const errors = [];
  // O primeiro servidor ganha mais tempo (consultas em áreas densas como São Paulo podem levar ~20 s).
  for (const [i, url] of overpassUrls().entries()) {
    const ms = i === 0 ? 35000 : 25000;
    try { return await overpassOnce(url, query, ms); }
    catch (e) { errors.push(`${new URL(url).host}: ${e.name === 'TimeoutError' ? `sem resposta em ${ms / 1000}s` : (e.cause?.code || e.message)}`); }
  }
  throw new Error(`Overpass indisponível (${errors.join('; ')})`);
}

// Cache em disco: se o OpenStreetMap falhar, a última consulta da região continua disponível
// (inclusive depois de reiniciar o servidor).
let cacheFile = null;
let persistTimer = null;
let onCacheSave = null;

function setCacheFile(file, { onSave } = {}) {
  cacheFile = file;
  onCacheSave = onSave || null;
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [k, v] of Object.entries(saved)) if (v && Array.isArray(v.data)) { searchCache.set(k, v); v.data.forEach(remember); }
  } catch { /* sem cache salvo */ }
}

function persistCache() {
  if (!cacheFile || persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const entries = [...searchCache.entries()].slice(-30);
    const tmp = `${cacheFile}.tmp`;
    try {
      const json = JSON.stringify(Object.fromEntries(entries));
      fs.writeFileSync(tmp, json);
      fs.renameSync(tmp, cacheFile);
      if (onCacheSave) onCacheSave(json);
    } catch { /* cache é opcional */ }
  }, 500);
  persistTimer.unref();
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const p = Math.PI / 180;
  const a = 0.5 - Math.cos((lat2 - lat1) * p) / 2 + Math.cos(lat1 * p) * Math.cos(lat2 * p) * (1 - Math.cos((lon2 - lon1) * p)) / 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

// Lugares de consultas anteriores (mesmo antigas) num raio da região pedida.
function staleNear(lat, lng, radiusKm) {
  const out = new Map();
  for (const [key, v] of searchCache) {
    const [klat, klng, krad] = key.split(',').map(Number);
    if (distanceKm(lat, lng, klat, klng) > radiusKm + krad) continue;
    for (const p of v.data) out.set(p.id, p);
  }
  return [...out.values()];
}

async function searchAround(lat, lng, radiusKm) {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)},${radiusKm}`;
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return { places: cached.data, stale: false };
  // Privacidade: o servidor do OpenStreetMap recebe o ponto arredondado (~110 m) e um raio
  // 150 m maior; a distância exata é calculada aqui, com a posição real, e nada é guardado.
  const r = Math.round(radiusKm * 1000) + 150;
  const qLat = lat.toFixed(3), qLng = lng.toFixed(3);
  const query = `[out:json][timeout:30];
(
  nwr[amenity~"^(restaurant|fast_food|cafe|bar|pub|biergarten|ice_cream|food_court)$"](around:${r},${qLat},${qLng});
  nwr[shop~"^(bakery|confectionery|pastry|ice_cream)$"](around:${r},${qLat},${qLng});
);
out center tags;`;
  let list;
  try { list = await overpass(query); }
  catch (e) {
    const stale = staleNear(lat, lng, radiusKm);
    if (stale.length) return { places: stale, stale: true, error: e };
    throw e;
  }
  list.forEach(remember);
  searchCache.delete(key);
  searchCache.set(key, { at: Date.now(), data: list });
  if (searchCache.size > 200) searchCache.delete(searchCache.keys().next().value);
  persistCache();
  return { places: list, stale: false };
}

// Busca um lugar do OSM pelo identificador (usado no F5 de #/restaurante/node-123).
async function findByRef(ref) {
  const m = OSM_REF.exec(String(ref));
  if (!m) return null;
  if (known.has(ref)) return known.get(ref);
  const list = await overpass(`[out:json][timeout:15];\n${m[1]}(${m[2]});\nout center tags;`);
  const place = list.find(p => p.id === ref) || null;
  if (place) remember(place);
  return place;
}

function knownPlace(ref) {
  return known.get(ref) || null;
}

function clearCache() {
  searchCache.clear();
  known.clear();
}

// Diagnóstico: consulta pequena em cada servidor Overpass (usado por /api/map-check).
async function checkOverpass() {
  const out = [];
  for (const url of overpassUrls()) {
    const t0 = Date.now();
    try {
      const list = await overpassOnce(url, '[out:json][timeout:10];\nnode[amenity=restaurant](around:300,-23.5613,-46.6565);\nout center tags 5;');
      out.push({ servidor: new URL(url).host, ok: true, tempo_ms: Date.now() - t0, lugares: list.length });
    } catch (e) {
      out.push({ servidor: new URL(url).host, ok: false, tempo_ms: Date.now() - t0, erro: e.name === 'TimeoutError' ? 'sem resposta em 15s' : (e.cause?.code || e.message) });
    }
  }
  return out;
}

module.exports = { setCacheFile, checkOverpass, OSM_REF, searchAround, findByRef, knownPlace, parseOpeningHours, isOpenByOsm, parseElement, clearCache };
