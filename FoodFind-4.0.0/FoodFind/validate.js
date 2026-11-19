// Funções de validação e limpeza de dados (str/clean*).
// Tudo que vem do usuário ou de fontes externas (OpenStreetMap) passa por aqui.
const { httpError } = require('./http');

const CATEGORIES = ['Restaurante', 'Café', 'Fast-food', 'Bar', 'Pizzaria', 'Lanchonete', 'Padaria', 'Sorveteria', 'Doceria', 'Outro'];
const PRICE_RANGES = ['', '$', '$$', '$$$', '$$$$'];
const DAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];

function str(v, max = 300) {
  // Remove caracteres de controle (exceto quebra de linha) e corta no tamanho máximo.
  return String(v ?? '').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
}

function normalizeName(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 200;
}

// Aceita apenas http(s) com domínio. Nunca devolve javascript:, data:, vbscript: etc.
function cleanUrl(v) {
  const s = str(v, 500);
  if (!s || /\s/.test(s)) return '';
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(s);
  if (hasScheme && !/^https?:\/\//i.test(s)) return '';
  try {
    const u = new URL(hasScheme ? s : `https://${s}`);
    if (!['http:', 'https:'].includes(u.protocol)) return '';
    if (u.username || u.password) return '';
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname) && !/^xn--/i.test(u.hostname)) return '';
    return u.href;
  } catch {
    return '';
  }
}

function cleanInstagram(v) {
  const s = str(v, 200);
  if (!s) return '';
  if (/instagram\.com/i.test(s)) {
    const url = cleanUrl(s);
    return url && /^https?:\/\/(www\.)?instagram\.com\//i.test(url) ? url : '';
  }
  const handle = s.replace(/^@/, '').replace(/[^A-Za-z0-9._]/g, '').slice(0, 30);
  return handle ? `https://instagram.com/${handle}` : '';
}

function cleanPhone(v) {
  const s = str(String(v ?? '').split(';')[0], 40).replace(/[^\d+()\- ]/g, '').trim();
  return s.replace(/\D/g, '').length >= 8 ? s : '';
}

function cleanTime(v) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v)) ? String(v) : ''; }

function cleanHours(h) {
  const out = {};
  for (const d of DAYS) {
    const day = (h && typeof h === 'object' && h[d]) || {};
    const open = cleanTime(day.open), close = cleanTime(day.close);
    out[d] = { closed: Boolean(day.closed) || !open || !close, open, close };
  }
  return out;
}

function cleanMenu(menu) {
  if (!Array.isArray(menu)) return [];
  return menu.slice(0, 300).map(item => {
    item = item && typeof item === 'object' ? item : {};
    const priceNum = Number(String(item.price ?? '').replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
    return {
      section: str(item.section, 60) || 'Pratos',
      name: str(item.name, 120),
      description: str(item.description, 400),
      price: Number.isFinite(priceNum) && priceNum > 0 && priceNum < 100000 ? Math.round(priceNum * 100) / 100 : null
    };
  }).filter(i => i.name);
}

const PHOTO_PATH = /^\/uploads\/([a-f0-9-]{36}\.(jpg|png|webp))$/;

// Só aceita fotos enviadas pelo próprio dono (ownedFiles = nomes de arquivo dele).
function cleanPhotos(photos, ownedFiles) {
  if (!Array.isArray(photos)) return [];
  return [...new Set(photos.map(String))]
    .filter(p => { const m = PHOTO_PATH.exec(p); return m && (!ownedFiles || ownedFiles.has(m[1])); })
    .slice(0, 12);
}

function cleanRestaurant(b, ownedFiles) {
  b = b && typeof b === 'object' ? b : {};
  const lat = Number(b.lat), lng = Number(b.lng);
  const r = {
    name: str(b.name, 120),
    category: CATEGORIES.includes(b.category) ? b.category : 'Restaurante',
    cuisine: str(b.cuisine, 120),
    description: str(b.description, 1500),
    website: cleanUrl(b.website),
    phone: cleanPhone(b.phone),
    whatsapp: str(b.whatsapp, 30).replace(/\D/g, '').slice(0, 13),
    instagram: cleanInstagram(b.instagram),
    delivery_url: cleanUrl(b.deliveryUrl),
    menu_url: cleanUrl(b.menuUrl),
    price_range: PRICE_RANGES.includes(b.priceRange) ? b.priceRange : '',
    address: str(b.address, 300),
    lat, lng,
    hours: JSON.stringify(cleanHours(b.hours)),
    menu: JSON.stringify(cleanMenu(b.menu)),
    photos: JSON.stringify(cleanPhotos(b.photos, ownedFiles))
  };
  if (!r.name) throw httpError(400, 'Informe o nome do restaurante.');
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
    throw httpError(400, 'Defina a localização do restaurante no mapa.');
  }
  if (str(b.website) && !r.website) throw httpError(400, 'A URL do site não é válida. Use um endereço http ou https, ex.: https://meurestaurante.com.br');
  if (str(b.deliveryUrl) && !r.delivery_url) throw httpError(400, 'O link de delivery não é válido. Use um endereço http ou https.');
  if (str(b.menuUrl) && !r.menu_url) throw httpError(400, 'O link do cardápio não é válido. Use um endereço http ou https.');
  if (str(b.instagram) && !r.instagram) throw httpError(400, 'O Instagram não é válido. Informe o @ ou o link do perfil.');
  return r;
}

const FIELDS = ['name', 'category', 'cuisine', 'description', 'website', 'phone', 'whatsapp', 'instagram', 'delivery_url', 'menu_url', 'price_range', 'address', 'lat', 'lng', 'hours', 'menu', 'photos'];

module.exports = {
  CATEGORIES, PRICE_RANGES, DAYS, FIELDS, PHOTO_PATH,
  str, normalizeName, isEmail, cleanUrl, cleanInstagram, cleanPhone, cleanTime, cleanHours, cleanMenu, cleanPhotos, cleanRestaurant
};
