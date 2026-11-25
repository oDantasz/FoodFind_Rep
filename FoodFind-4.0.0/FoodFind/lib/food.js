// Preferências e restrições alimentares: vocabulário, validação e o cálculo de quanto
// cada restaurante combina com a pessoa (usado para ordenar e filtrar a busca).
//
// Fontes de informação sobre o restaurante:
// - cadastrados no FoodFind: opções marcadas pelo dono (restaurants.diets);
// - OpenStreetMap: etiquetas diet:* (yes/only/limited/no) e cuisine=vegetarian/vegan.
// Quando não há informação, o lugar fica como "sem informação" (não é escondido) e a
// interface pede para confirmar com o restaurante. Nada aqui substitui essa confirmação.
const { httpError } = require('./http');

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Estilo alimentar (escolha única).
const STYLES = [
  { key: 'none', label: 'Como de tudo' },
  { key: 'flexitarian', label: 'Flexitariano (pouca carne)' },
  { key: 'pescetarian', label: 'Pescetariano (peixe, sem carne)' },
  { key: 'vegetarian', label: 'Vegetariano' },
  { key: 'vegan', label: 'Vegano' }
];

// Alergias e intolerâncias: os principais grupos de alergênicos destacados na rotulagem de
// alimentos no Brasil (ANVISA) mais a intolerância à lactose.
const ALLERGIES = [
  { key: 'gluten', label: 'Glúten (doença celíaca ou sensibilidade)', offer: 'gluten_free' },
  { key: 'lactose', label: 'Lactose (intolerância)', offer: 'lactose_free', alsoOffer: ['milk_free', 'vegan'] },
  { key: 'milk', label: 'Leite e derivados (alergia à proteína do leite)', offer: 'milk_free', alsoOffer: ['vegan'] },
  { key: 'egg', label: 'Ovos', offer: 'egg_free', alsoOffer: ['vegan'] },
  { key: 'peanut', label: 'Amendoim', offer: 'peanut_free' },
  { key: 'tree_nuts', label: 'Castanhas e nozes', offer: 'nut_free' },
  { key: 'soy', label: 'Soja', offer: 'soy_free' },
  { key: 'fish', label: 'Peixes', offer: 'fish_free' },
  { key: 'shellfish', label: 'Crustáceos e frutos do mar', offer: 'shellfish_free' },
  { key: 'sesame', label: 'Gergelim', offer: 'sesame_free' }
];

// Outras restrições (religiosas, de saúde ou de dieta).
const RESTRICTIONS = [
  { key: 'halal', label: 'Halal', offer: 'halal', hard: true },
  { key: 'kosher', label: 'Kosher', offer: 'kosher', hard: true },
  { key: 'no_pork', label: 'Sem carne de porco', offer: 'no_pork', alsoOffer: ['halal', 'kosher', 'vegetarian', 'vegan'] },
  { key: 'low_sugar', label: 'Pouco açúcar ou diabetes', offer: 'sugar_free' },
  { key: 'low_carb', label: 'Low carb', offer: 'low_carb' },
  { key: 'low_sodium', label: 'Pouco sal (hipertensão)', offer: 'low_sodium' },
  { key: 'no_alcohol', label: 'Lugar sem bebida alcoólica', offer: 'no_alcohol' }
];

// O que o restaurante oferece (marcado pelo dono no painel ou vindo do OSM).
const OFFERS = [
  { key: 'vegetarian', label: 'Opções vegetarianas' },
  { key: 'vegan', label: 'Opções veganas' },
  { key: 'gluten_free', label: 'Sem glúten' },
  { key: 'lactose_free', label: 'Sem lactose' },
  { key: 'milk_free', label: 'Sem leite (proteína do leite)' },
  { key: 'egg_free', label: 'Sem ovos' },
  { key: 'peanut_free', label: 'Sem amendoim' },
  { key: 'nut_free', label: 'Sem castanhas e nozes' },
  { key: 'soy_free', label: 'Sem soja' },
  { key: 'fish_free', label: 'Sem peixe' },
  { key: 'shellfish_free', label: 'Sem frutos do mar' },
  { key: 'sesame_free', label: 'Sem gergelim' },
  { key: 'halal', label: 'Halal' },
  { key: 'kosher', label: 'Kosher' },
  { key: 'no_pork', label: 'Sem carne de porco' },
  { key: 'sugar_free', label: 'Sem açúcar / diet' },
  { key: 'low_carb', label: 'Low carb' },
  { key: 'low_sodium', label: 'Pouco sal' },
  { key: 'no_alcohol', label: 'Sem bebida alcoólica' },
  { key: 'allergy_care', label: 'Informa ingredientes e cuida da contaminação cruzada' }
];

// Comidas favoritas. As palavras-chave valem para a culinária do OSM (em inglês) e para
// os cadastros do FoodFind (em português), inclusive nomes de itens do cardápio.
const CUISINES = [
  { key: 'brasileira', label: 'Brasileira e caseira', words: ['brazilian', 'brasileir', 'caseir', 'feijoada', 'regional', 'mineir', 'nordestin', 'self-service', 'prato feito'] },
  { key: 'italiana', label: 'Italiana e massas', words: ['italian', 'italiana', 'massa', 'pasta', 'cantina', 'lasanha', 'talharim', 'nhoque'] },
  { key: 'pizza', label: 'Pizza', words: ['pizza'], categories: ['Pizzaria'] },
  { key: 'japonesa', label: 'Japonesa e sushi', words: ['japanese', 'japones', 'sushi', 'temaki', 'ramen', 'sashimi'] },
  { key: 'asiatica', label: 'Chinesa e asiática', words: ['chinese', 'chines', 'asian', 'asiatic', 'thai', 'tailandes', 'korean', 'corean', 'vietnam', 'yakisoba'] },
  { key: 'arabe', label: 'Árabe', words: ['arab', 'lebanese', 'libanes', 'turkish', 'turc', 'esfiha', 'kebab', 'falafel', 'kibe'] },
  { key: 'mexicana', label: 'Mexicana', words: ['mexican', 'mexicana', 'tex-mex', 'taco', 'burrito', 'nacho'] },
  { key: 'peruana', label: 'Peruana e latina', words: ['peruvian', 'peruan', 'ceviche', 'latin', 'argentin'] },
  { key: 'indiana', label: 'Indiana', words: ['indian', 'indiana', 'curry'] },
  { key: 'hamburguer', label: 'Hambúrguer e lanches', words: ['burger', 'hamburg', 'sandwich', 'sanduich', 'lanche', 'hot_dog', 'cachorro-quente'], categories: ['Lanchonete', 'Fast-food'] },
  { key: 'churrasco', label: 'Churrasco e carnes', words: ['steak', 'barbecue', 'bbq', 'churrasc', 'grill', 'carnes', 'picanha'] },
  { key: 'frutos_do_mar', label: 'Peixes e frutos do mar', words: ['seafood', 'fish', 'frutos do mar', 'peixe', 'camarao', 'moqueca'] },
  { key: 'saudavel', label: 'Saudável e saladas', words: ['salad', 'healthy', 'saudavel', 'salada', 'natural', 'poke', 'bowl', 'vegetarian', 'vegan'] },
  { key: 'cafe', label: 'Café e lanche da tarde', words: ['coffee', 'cafe', 'cafeteria', 'brunch'], categories: ['Café'] },
  { key: 'padaria', label: 'Padaria', words: ['bakery', 'padaria', 'pao '], categories: ['Padaria'] },
  { key: 'doces', label: 'Doces e sobremesas', words: ['dessert', 'cake', 'confeitaria', 'doce', 'chocolate', 'pastry', 'brigadeiro', 'bolo'], categories: ['Doceria'] },
  { key: 'sorvete', label: 'Sorvete e açaí', words: ['ice_cream', 'sorvete', 'gelato', 'acai', 'frozen'], categories: ['Sorveteria'] },
  { key: 'bar', label: 'Bar e petiscos', words: ['pub', 'boteco', 'petisco', 'cerveja', 'beer', 'chopp'], categories: ['Bar'] }
];

const PRICES = ['$', '$$', '$$$', '$$$$'];

const STYLE_KEYS = STYLES.map(s => s.key);
const OFFER_KEYS = OFFERS.map(o => o.key);
const label = (list, key) => (list.find(x => x.key === key) || {}).label || key;

function pick(list, allowed, max = 30) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(String).filter(k => allowed.includes(k)))].slice(0, max);
}

// Dados de saúde (alergias, diabetes, hipertensão), religiosos (halal, kosher) e de convicção
// (vegetarianismo, veganismo) são dados pessoais sensíveis na LGPD (art. 5º, II): só são
// gravados com consentimento específico e destacado (art. 11, I).
function cleanPreferences(b) {
  b = b && typeof b === 'object' ? b : {};
  const p = {
    style: STYLE_KEYS.includes(b.style) ? b.style : 'none',
    allergies: pick(b.allergies, ALLERGIES.map(a => a.key)),
    restrictions: pick(b.restrictions, RESTRICTIONS.map(r => r.key)),
    cuisines: pick(b.cuisines, CUISINES.map(c => c.key)),
    prices: pick(b.prices, PRICES)
  };
  const sensitive = hasSensitive(p);
  if (sensitive && b.sensitiveConsent !== true) {
    throw httpError(400, 'Para guardar alergias, restrições e estilo alimentar, marque a autorização de uso desses dados.', 'consent_required');
  }
  return p;
}

const hasSensitive = p => Boolean(p && ((p.style && !['none', 'flexitarian'].includes(p.style)) || p.allergies.length || p.restrictions.length));

function cleanOffers(list) {
  return pick(list, OFFER_KEYS);
}

// Etiquetas diet:* do OSM → o que o lugar oferece (yes) e o que declara não oferecer (no).
const OSM_DIET = {
  vegetarian: 'vegetarian', vegan: 'vegan', gluten_free: 'gluten_free', lactose_free: 'lactose_free',
  halal: 'halal', kosher: 'kosher', dairy_free: 'milk_free', diabetes: 'sugar_free', egg_free: 'egg_free',
  nut_free: 'nut_free', peanut_free: 'peanut_free', soy_free: 'soy_free'
};
function osmOffers(tags) {
  const yes = new Set(), no = new Set();
  for (const [tag, key] of Object.entries(OSM_DIET)) {
    const v = String(tags[`diet:${tag}`] || '').toLowerCase();
    if (['yes', 'only', 'limited'].includes(v)) yes.add(key);
    else if (v === 'no') no.add(key);
  }
  const cuisine = norm(tags.cuisine);
  if (/\bvegan\b/.test(cuisine)) yes.add('vegan');
  if (/\bvegetarian\b/.test(cuisine) || yes.has('vegan')) yes.add('vegetarian');
  if (String(tags['drink:alcohol'] || '').toLowerCase() === 'no') yes.add('no_alcohol');
  return { offers: [...yes], offersNo: [...no].filter(k => !yes.has(k)) };
}

// Sinais de risco quando o lugar não declara a opção: culinárias em que o ingrediente
// costuma ser a base (ex.: sushi para quem tem alergia a peixe).
const RISK = {
  gluten: { words: ['pizza', 'pasta', 'massa', 'burger', 'hamburg', 'bakery', 'padaria', 'esfiha', 'pastel', 'cake', 'bolo'], categories: ['Pizzaria', 'Padaria', 'Doceria', 'Lanchonete'] },
  lactose: { words: ['pizza', 'ice_cream', 'sorvete', 'gelato', 'cheese', 'queijo', 'fondue'], categories: ['Sorveteria'] },
  milk: { words: ['pizza', 'ice_cream', 'sorvete', 'gelato', 'cheese', 'queijo', 'fondue'], categories: ['Sorveteria', 'Doceria'] },
  fish: { words: ['sushi', 'japanese', 'japones', 'seafood', 'fish', 'peixe', 'frutos do mar', 'ceviche', 'poke'] },
  shellfish: { words: ['seafood', 'frutos do mar', 'camarao', 'sushi', 'moqueca'] },
  peanut: { words: ['thai', 'tailandes', 'chinese', 'chines'] },
  tree_nuts: { words: ['doce', 'confeitaria', 'cake', 'bolo'], categories: ['Doceria'] },
  sesame: { words: ['arab', 'lebanese', 'libanes', 'esfiha', 'japanese', 'sushi', 'falafel'] },
  egg: { words: ['bakery', 'padaria', 'cake', 'bolo', 'doce'], categories: ['Padaria', 'Doceria'] },
  vegetarian: { words: ['steak', 'churrasc', 'barbecue', 'bbq', 'carnes', 'picanha'] },
  vegan: { words: ['steak', 'churrasc', 'barbecue', 'bbq', 'carnes', 'picanha', 'ice_cream', 'sorvete', 'cheese', 'queijo'] }
};

function textOf(r) {
  return ` ${norm([r.name, r.cuisine, r.description, ...(r.menu || []).map(m => `${m.name} ${m.section}`)].join(' '))} `;
}
const hits = (text, words) => (words || []).some(w => text.includes(norm(w)));

// Calcula quanto o restaurante combina com as preferências.
// status: 'ok' (atende tudo o que é obrigatório) · 'unknown' (sem informação) ·
//         'risk' (culinária costuma ter o ingrediente) · 'conflict' (o lugar declara que não atende) · 'none' (sem restrições)
function matchRestaurant(r, p) {
  const offers = new Set(r.offers || []);
  const offersNo = new Set(r.offersNo || []);
  const text = textOf(r);
  const needs = []; // { key, label, any: [ofertas que atendem] }
  if (p.style === 'vegan') needs.push({ key: 'vegan', label: 'Vegano', any: ['vegan'], none: ['vegan', 'vegetarian'] });
  if (p.style === 'vegetarian') needs.push({ key: 'vegetarian', label: 'Vegetariano', any: ['vegetarian', 'vegan'] });
  for (const k of p.allergies) {
    const a = ALLERGIES.find(x => x.key === k);
    needs.push({ key: k, label: `Sem ${a.label.split(' (')[0].toLowerCase()}`, any: [a.offer, ...(a.alsoOffer || [])] });
  }
  for (const k of p.restrictions) {
    const x = RESTRICTIONS.find(y => y.key === k);
    if (x.hard) needs.push({ key: k, label: x.label, any: [x.offer] });
  }

  const ok = [], unknown = [], risk = [], conflict = [];
  for (const n of needs) {
    if (n.any.some(o => offers.has(o))) ok.push(n.label);
    else if ((n.none || [n.any[0]]).some(o => offersNo.has(o))) conflict.push(n.label);
    else if (RISK[n.key] && (hits(text, RISK[n.key].words) || (RISK[n.key].categories || []).includes(r.category))) risk.push(n.label);
    else unknown.push(n.label);
  }
  let status = 'none';
  if (needs.length) status = conflict.length ? 'conflict' : risk.length ? 'risk' : unknown.length ? 'unknown' : 'ok';

  // Gostos (não eliminam ninguém; só aumentam a pontuação).
  const likes = [];
  for (const k of p.cuisines) {
    const c = CUISINES.find(x => x.key === k);
    if ((c.categories || []).includes(r.category) || hits(text, c.words)) likes.push(c.label);
  }
  const extras = [];
  for (const k of p.restrictions) {
    const x = RESTRICTIONS.find(y => y.key === k);
    if (!x.hard && [x.offer, ...(x.alsoOffer || [])].some(o => offers.has(o))) extras.push(x.label);
  }
  if (p.style === 'pescetarian' && (offers.has('vegetarian') || offers.has('vegan') || hits(text, CUISINES.find(c => c.key === 'frutos_do_mar').words))) extras.push('Pescetariano');
  if (p.style === 'flexitarian' && (offers.has('vegetarian') || offers.has('vegan'))) extras.push('Opções sem carne');
  if (p.allergies.length && offers.has('allergy_care')) extras.push('Cuida de alergias');
  const priceOk = p.prices.length && r.priceRange && p.prices.includes(r.priceRange);

  const bucket = { ok: 4, none: 3, unknown: 2, risk: 1, conflict: 0 }[status];
  const score = likes.length * 30 + extras.length * 15 + (priceOk ? 10 : 0) + ok.length * 5;
  return { status, bucket, score, ok, unknown, risk, conflict, likes, extras, price: Boolean(priceOk) };
}

function options() {
  const strip = list => list.map(({ key, label: l, hard }) => (hard ? { key, label: l, hard } : { key, label: l }));
  return { styles: strip(STYLES), allergies: strip(ALLERGIES), restrictions: strip(RESTRICTIONS), cuisines: strip(CUISINES), offers: strip(OFFERS), prices: PRICES };
}

module.exports = { STYLES, ALLERGIES, RESTRICTIONS, OFFERS, CUISINES, PRICES, OFFER_KEYS, cleanPreferences, cleanOffers, hasSensitive, osmOffers, matchRestaurant, options, label };
