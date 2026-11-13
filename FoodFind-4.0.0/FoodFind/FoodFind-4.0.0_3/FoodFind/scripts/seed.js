#!/usr/bin/env node
// Dados de demonstração: contas de teste, restaurantes, campanhas e avaliações.
// Uso: npm run seed               (não duplica se já foi aplicado)
//      npm run seed -- --reset    (apaga as contas de demonstração e recria tudo)
//      npm run seed -- --detalhes (também mostra o link de resgate e o voucher de exemplo)
// A pasta de dados segue FOODFIND_DATA_DIR (padrão ./data).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const db = require('../db');
const { hashPassword } = require('../lib/security');

const PASSWORD = process.env.SEED_PASSWORD || 'FoodFind@2026';
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || 'admin@foodfind.local').trim().toLowerCase();
const ACCOUNTS = [
  { key: 'admin', name: 'Administrador FoodFind', email: ADMIN_EMAIL, role: 'cliente' },
  { key: 'cliente', name: 'Carla Cliente Souza', email: 'cliente@foodfind.local', role: 'cliente' },
  { key: 'cliente2', name: 'Bruno Teste Lima', email: 'cliente2@foodfind.local', role: 'cliente' },
  { key: 'dono', name: 'Rafael Restaurante Alves', email: 'restaurante@foodfind.local', role: 'restaurante' },
  { key: 'dono2', name: 'Marina Dona Costa', email: 'restaurante2@foodfind.local', role: 'restaurante' }
];

// ---- PNG simples (gradiente com "pratos"), sem dependências ----
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makePng(w, h, [r1, g1, b1], [r2, g2, b2], seed) {
  const rows = [];
  const plates = [0, 1, 2].map(i => ({ x: (0.22 + 0.28 * i) * w, y: (0.45 + 0.12 * Math.sin(seed + i)) * h, r: (0.13 + 0.03 * ((seed + i) % 3)) * w }));
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      const t = (x / w + y / h) / 2;
      let r = r1 + (r2 - r1) * t, g = g1 + (g2 - g1) * t, b = b1 + (b2 - b1) * t;
      for (const p of plates) {
        const d = Math.hypot(x - p.x, y - p.y);
        if (d < p.r) { const inner = d < p.r * 0.72; r = inner ? 250 : 236; g = inner ? 244 : 228; b = inner ? 236 : 220; if (inner && d < p.r * 0.45) { r = 200 - (seed * 30) % 80; g = 120 + (seed * 17) % 60; b = 60; } }
      }
      row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

function savePhoto(ownerId, colors, seed) {
  const file = `${crypto.randomUUID()}.png`;
  fs.writeFileSync(path.join(db.UPLOAD_DIR, file), makePng(640, 400, colors[0], colors[1], seed));
  db.run('INSERT INTO uploads (file, owner_id, created_at) VALUES (?, ?, ?)', [file, ownerId, Date.now()]);
  return `/uploads/${file}`;
}

const allWeek = (open, close) => Object.fromEntries(['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'].map(d => [d, { closed: false, open, close }]));

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...crypto.randomBytes(16)].map(b => A[b % 32]).join('');
}

async function main() {
  const running = db.activeLock();
  if (running && !process.argv.includes('--force')) {
    console.error(`O servidor FoodFind está usando esta pasta de dados (processo ${running.pid} em ${running.host}, desde ${running.startedAt}).`);
    console.error('Pare o servidor antes de rodar o seed (ele mantém o banco em memória e sobrescreveria os dados).');
    console.error('Docker: docker compose stop foodfind && docker compose run --rm foodfind npm run seed && docker compose start foodfind');
    console.error('Se o servidor não estiver rodando (trava antiga), use: npm run seed -- --force');
    process.exit(2);
  }
  const info = await db.init();
  const reset = process.argv.includes('--reset');
  const existing = db.get('SELECT id FROM users WHERE email = ?', ['restaurante@foodfind.local']);
  if (existing && !reset) {
    console.log('Os dados de demonstração já existem. Use "npm run seed -- --reset" para recriá-los.');
    return;
  }
  if (reset) {
    const emails = ACCOUNTS.map(a => a.email);
    const files = db.all(`SELECT file FROM uploads WHERE owner_id IN (SELECT id FROM users WHERE email IN (${emails.map(() => '?').join(',')}))`, emails).map(r => r.file);
    db.tx(() => {
      for (const r of db.all(`SELECT r.id FROM restaurants r JOIN users u ON u.id = r.owner_id WHERE u.email IN (${emails.map(() => '?').join(',')}) AND r.osm_ref IS NULL`, emails)) {
        db.run('DELETE FROM reviews WHERE place_ref = ?', [`ff-${r.id}`]);
      }
      db.run(`DELETE FROM users WHERE email IN (${emails.map(() => '?').join(',')})`, emails);
    });
    for (const f of files) fs.rmSync(path.join(db.UPLOAD_DIR, f), { force: true });
  }

  const hash = await hashPassword(PASSWORD);
  const now = new Date();
  const iso = d => d.toISOString();
  const days = n => new Date(now.getTime() + n * 86400000);
  const ids = {};

  db.tx(() => {
    for (const a of ACCOUNTS) {
      if (db.get('SELECT id FROM users WHERE email = ?', [a.email])) { ids[a.key] = db.get('SELECT id FROM users WHERE email = ?', [a.email]).id; continue; }
      ids[a.key] = db.run('INSERT INTO users (name, email, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [a.name, a.email, hash, a.role, iso(now), iso(now)]);
    }

    const restaurants = [
      {
        owner: 'dono', name: 'Cantina Bella Paulista', category: 'Restaurante', cuisine: 'italiana, massas', price: '$$',
        description: 'Massas frescas feitas na casa, molhos da nonna e ambiente familiar a poucos passos da Avenida Paulista.',
        address: 'Rua Frei Caneca, 1000, Consolação, São Paulo', lat: -23.5578, lng: -46.6545,
        website: 'https://exemplo.com.br/cantina-bella', phone: '(11) 3333-1000', whatsapp: '11999990001', instagram: 'https://instagram.com/cantinabella',
        hours: allWeek('11:30', '23:00'),
        menu: [
          { section: 'Massas', name: 'Talharim ao sugo', description: 'Molho de tomate italiano e manjericão', price: 42.9 },
          { section: 'Massas', name: 'Lasanha à bolonhesa', description: 'Receita da casa', price: 54.9 },
          { section: 'Sobremesas', name: 'Tiramisù', description: '', price: 24 }
        ],
        colors: [[160, 30, 30], [250, 180, 60]]
      },
      {
        owner: 'dono', name: 'Sushi Paraíso', category: 'Restaurante', cuisine: 'japonesa, sushi', price: '$$$',
        description: 'Sushi e temaki preparados na hora, com peixes selecionados.',
        address: 'Alameda Santos, 1500, Jardim Paulista, São Paulo', lat: -23.5640, lng: -46.6560,
        website: 'https://exemplo.com.br/sushi-paraiso', phone: '(11) 3333-2000', whatsapp: '', instagram: '',
        hours: Object.assign(allWeek('18:00', '23:30'), { seg: { closed: true, open: '', close: '' } }),
        menu: [
          { section: 'Temakis', name: 'Temaki de salmão', description: 'Salmão, cream cheese e cebolinha', price: 32 },
          { section: 'Combinados', name: 'Combinado 20 peças', description: '', price: 89.9 }
        ],
        colors: [[20, 40, 70], [200, 60, 60]]
      },
      {
        owner: 'dono2', name: 'Padaria Pão da Augusta', category: 'Padaria', cuisine: 'café da manhã, lanches', price: '$',
        description: 'Pão na chapa, café coado e salgados fresquinhos o dia todo.',
        address: 'Rua Augusta, 2000, Cerqueira César, São Paulo', lat: -23.5590, lng: -46.6610,
        website: '', phone: '(11) 3333-3000', whatsapp: '11999990003', instagram: '@paodaaugusta',
        hours: allWeek('06:00', '22:00'),
        menu: [
          { section: 'Café', name: 'Pão na chapa', description: '', price: 9.5 },
          { section: 'Café', name: 'Café coado', description: '', price: 6 }
        ],
        colors: [[120, 70, 30], [240, 210, 160]]
      }
    ];

    ids.restaurants = restaurants.map((r, i) => {
      const owner = ids[r.owner];
      const photos = [savePhoto(owner, r.colors, i + 1), savePhoto(owner, [r.colors[1], r.colors[0]], i + 4)];
      return db.run(`INSERT INTO restaurants (owner_id, osm_ref, name, category, cuisine, description, website, phone, whatsapp, instagram, delivery_url, menu_url, price_range, address, lat, lng, hours, menu, photos, created_at, updated_at)
        VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [owner, r.name, r.category, r.cuisine, r.description, r.website, r.phone, r.whatsapp, r.instagram, r.price, r.address, r.lat, r.lng,
        JSON.stringify(r.hours), JSON.stringify(r.menu), JSON.stringify(photos), iso(now), iso(now)]);
    });

    const [cantina, sushi, padaria] = ids.restaurants;
    const campaigns = [
      { restaurant: cantina, title: '15% no almoço executivo', description: 'Válido para pratos executivos, de segunda a sexta, no consumo no local.', type: 'percent', value: 15, start: days(-1), end: days(30), max: 100, active: 1 },
      { restaurant: cantina, title: 'Sobremesa por R$ 10 a menos', description: 'Desconto em qualquer sobremesa no jantar.', type: 'fixed', value: 10, start: days(7), end: days(37), max: null, active: 1 },
      { restaurant: sushi, title: '10% no combinado', description: 'Desconto no combinado de 20 peças.', type: 'percent', value: 10, start: days(-2), end: days(20), max: 50, active: 0 },
      { restaurant: padaria, title: 'Café grátis na compra de pão na chapa', description: 'Café coado pequeno por conta da casa.', type: 'fixed', value: 6, start: days(-30), end: days(-1), max: 200, active: 1 }
    ];
    ids.campaigns = campaigns.map(c => db.run(`INSERT INTO campaigns (restaurant_id, code, title, description, discount_type, discount_value, starts_at, ends_at, max_redemptions, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [c.restaurant, newCode(), c.title, c.description, c.type, c.value, iso(c.start), iso(c.end), c.max, c.active, iso(now), iso(now)]));

    const reviews = [
      [cantina, 'cliente', 5, 'Massa excelente e atendimento muito simpático!'],
      [cantina, 'cliente2', 4, 'Muito bom, só demorou um pouco no horário de pico.'],
      [sushi, 'cliente', 4, 'Peixe fresco, temaki bem servido.'],
      [padaria, 'cliente2', 5, 'O melhor pão na chapa da Augusta.']
    ];
    for (const [rid, who, rating, comment] of reviews) {
      const name = db.get('SELECT name FROM restaurants WHERE id = ?', [rid]).name;
      db.run('INSERT INTO reviews (place_ref, place_name, user_id, rating, comment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [`ff-${rid}`, name, ids[who], rating, comment, iso(days(-3)), iso(days(-3))]);
    }

    // Um voucher já emitido para a cliente 2 na campanha ativa (para demonstrar a validação pelo dono).
    db.run('INSERT INTO redemptions (campaign_id, user_id, check_code, status, redeemed_at) VALUES (?, ?, ?, ?, ?)', [ids.campaigns[0], ids.cliente2, db.randomCheckCode(), 'emitido', iso(days(-1))]);
  });

  const active = db.get('SELECT code FROM campaigns WHERE id = ?', [ids.campaigns[0]]);
  const voucher = db.get('SELECT id, check_code FROM redemptions WHERE campaign_id = ?', [ids.campaigns[0]]);
  const base = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');
  console.log(`Dados de demonstração criados em ${info.DATA_DIR}`);
  console.log(`Senha de todas as contas: ${PASSWORD === 'FoodFind@2026' ? 'FoodFind@2026' : '(definida em SEED_PASSWORD)'}`);
  for (const a of ACCOUNTS) console.log(`  ${a.key.padEnd(9)} ${a.email} (${a.role}${a.key === 'admin' ? ', administrador se ADMIN_EMAIL for este e-mail' : ''})`);
  console.log('Campanhas: ativa (Cantina), agendada (Cantina), pausada (Sushi), encerrada (Padaria).');
  if (process.argv.includes('--detalhes')) {
    // Só com --detalhes: o código da campanha é secreto e não deve ir para logs.
    console.log(`Link de resgate da campanha ativa: ${base}/?resgatar=${active.code}`);
    console.log(`Voucher já emitido para cliente2: FF-${String(voucher.id).padStart(6, '0')} · código de conferência ${voucher.check_code}`);
  } else {
    console.log('O QR Code da campanha ativa aparece para o dono em Campanhas e vouchers. Use --detalhes para imprimir o link e o voucher de exemplo.');
  }
}

main()
  // Com DATABASE_URL, espera a cópia chegar ao PostgreSQL antes de encerrar.
  .then(() => db.closeRemote())
  .catch(e => { console.error('Falha ao criar os dados de demonstração:', e.message); process.exit(1); });
