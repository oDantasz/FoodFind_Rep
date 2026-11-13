// Segurança e infraestrutura: cabeçalhos, CSRF, upload, geocode/tiles protegidos, map-check,
// arquivos estáticos, versões, migração de banco antigo e erros que não derrubam o servidor.
const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const initSqlJs = require('sql.js');
const { ROOT, startServer, client, registerUser, createRestaurant, restaurantBody, uniqueEmail } = require('./_helpers');

describe('Segurança e infraestrutura', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(async () => { await srv.stop(); });

  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1a, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(14)]);

  test('Cabeçalhos de segurança em páginas e na API', async () => {
    for (const url of ['/', '/api/health', '/api/rota-inexistente']) {
      const r = await fetch(srv.base + url);
      const csp = r.headers.get('content-security-policy');
      assert.match(csp, /default-src 'self'/);
      assert.match(csp, /script-src 'self' https:\/\/unpkg\.com(;|$)/, 'sem unsafe-inline em scripts');
      assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
      assert.match(csp, /frame-ancestors 'none'/);
      assert.match(csp, /object-src 'none'/);
      assert.match(csp, /tile\.openstreetmap\.org/);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
      assert.equal(r.headers.get('x-frame-options'), 'DENY');
      assert.match(r.headers.get('permissions-policy'), /camera=\(self\).*geolocation=\(self\)/);
    }
    const https = await fetch(`${srv.base}/`, { headers: { 'x-forwarded-proto': 'https' } });
    assert.match(https.headers.get('strict-transport-security'), /max-age=/);
  });

  test('SRI: todo script e estilo externo do index.html tem integrity e crossorigin', async () => {
    const html = await (await fetch(`${srv.base}/`)).text();
    const external = [...html.matchAll(/<(script|link)\b[^>]*(?:src|href)="https?:\/\/[^"]+"[^>]*>/g)].map(m => m[0]);
    assert.ok(external.length >= 5);
    for (const tag of external) {
      assert.match(tag, /integrity="sha384-[A-Za-z0-9+/=]{64}"/, tag);
      assert.match(tag, /crossorigin="anonymous"/, tag);
    }
    assert.doesNotMatch(html, /\son[a-z]+="/i, 'sem handlers inline (onclick etc.)');
    assert.doesNotMatch(html, /<script>(?!<\/script>)/, 'sem script inline');
    assert.doesNotMatch(html, /fonts\.googleapis/, 'fontes servidas localmente');
    const app = await (await fetch(`${srv.base}/app.js`)).text();
    assert.match(app, /integrity: 'sha384-[A-Za-z0-9+/=]{64}'/, 'jsQR carregado com SRI');
    assert.doesNotMatch(app, /api\.qrserver\.com/, 'QR não usa serviço externo');
    assert.doesNotMatch(app, /cartocdn/, 'CARTO exige chave e deixava o mapa cinza');
  });

  test('CSRF: POST de outra origem é recusado; JSON obrigatório', async () => {
    const u = await registerUser(srv.base);
    const evil = await u.post('/api/me/logout-all', {}, { origin: 'https://site-malicioso.example' });
    assert.equal(evil.status, 403);
    assert.equal(evil.json.code, 'bad_origin');
    const site = await u.put('/api/me', { name: 'Ok' }, { 'sec-fetch-site': 'cross-site' });
    assert.equal(site.status, 403);
    const form = await fetch(`${srv.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=a@b.com&password=x' });
    assert.equal(form.status, 415);
    const same = await u.put('/api/me', { name: 'Mesma Origem' }, { origin: srv.base });
    assert.equal(same.status, 200);
  });

  test('Upload: confere o conteúdo real (magic bytes), tipo e tamanho', async () => {
    const owner = await registerUser(srv.base, { role: 'restaurante' });
    const up = (mime, buf) => owner.post('/api/uploads', { dataUrl: `data:image/${mime};base64,${buf.toString('base64')}` });
    for (const [mime, buf, ext] of [['png', PNG, 'png'], ['jpeg', JPG, 'jpg'], ['webp', WEBP, 'webp']]) {
      const r = await up(mime, buf);
      assert.equal(r.status, 201, mime);
      assert.match(r.json.url, new RegExp(`^/uploads/[a-f0-9-]{36}\\.${ext}$`));
      const img = await fetch(srv.base + r.json.url);
      assert.equal(img.status, 200);
      assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
    }
    // Tipo declarado mente: HTML disfarçado de PNG.
    const fake = await up('png', Buffer.from('<html><script>alert(1)</script></html>'));
    assert.equal(fake.status, 400);
    assert.equal(fake.json.code, 'invalid_image');
    // PNG declarado como JPEG é salvo como PNG (extensão pelo conteúdo).
    const mismatch = await up('jpeg', PNG);
    assert.match(mismatch.json.url, /\.png$/);
    assert.equal((await owner.post('/api/uploads', { dataUrl: 'data:image/gif;base64,R0lGODlh' })).status, 400);
    assert.equal((await owner.post('/api/uploads', { dataUrl: 'nada' })).status, 400);
    const big = await up('png', Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 + 10)]));
    assert.equal(big.status, 413);
    const huge = await fetch(`${srv.base}/api/uploads`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: owner.cookie }, body: JSON.stringify({ dataUrl: 'x'.repeat(9 * 1024 * 1024) }) });
    assert.equal(huge.status, 413);
    assert.equal((await (await registerUser(srv.base)).post('/api/uploads', { dataUrl: `data:image/png;base64,${PNG.toString('base64')}` })).status, 403);
  });

  test('Fotos: só as do próprio dono são aceitas e as removidas são apagadas do disco', async () => {
    const owner = await registerUser(srv.base, { role: 'restaurante' });
    const thief = await registerUser(srv.base, { role: 'restaurante' });
    const a = (await owner.post('/api/uploads', { dataUrl: `data:image/png;base64,${PNG.toString('base64')}` })).json.url;
    const b = (await owner.post('/api/uploads', { dataUrl: `data:image/png;base64,${PNG.toString('base64')}` })).json.url;
    const stolen = await createRestaurant(thief, { photos: [a] });
    assert.deepEqual(stolen.photos, [], 'foto de outro dono é ignorada');
    const r = await createRestaurant(owner, { photos: [a, b] });
    assert.deepEqual(r.photos, [a, b]);
    await owner.put(`/api/my/restaurants/${r.id}`, restaurantBody({ photos: [b] }));
    await new Promise(res => setTimeout(res, 100));
    assert.ok(!fs.existsSync(path.join(srv.dir, a)), 'foto removida foi apagada');
    assert.ok(fs.existsSync(path.join(srv.dir, b)));
    await owner.del(`/api/my/restaurants/${r.id}`);
    await new Promise(res => setTimeout(res, 100));
    assert.ok(!fs.existsSync(path.join(srv.dir, b)), 'fotos do restaurante excluído foram apagadas');
  });

  test('Geocode protegido: exige origem do próprio site, tem cache e limite por IP', async () => {
    const r = await fetch(`${srv.base}/api/geocode?q=vila%20mariana`);
    assert.equal(r.status, 403);
    const other = await fetch(`${srv.base}/api/geocode?q=vila%20mariana`, { headers: { 'sec-fetch-site': 'cross-site' } });
    assert.equal(other.status, 403);
    const ok = await fetch(`${srv.base}/api/geocode?q=vila%20mariana`, { headers: { 'sec-fetch-site': 'same-origin' } });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).results[0].label, 'Vila Mariana, São Paulo, SP');
    const before = srv.mock.state.geocodeCalls;
    await fetch(`${srv.base}/api/geocode?q=Vila%20Mariana`, { headers: { referer: `${srv.base}/` } });
    assert.equal(srv.mock.state.geocodeCalls, before, 'segunda busca igual veio do cache');
    const limited = await startServer({ env: { FOODFIND_GEOCODE_MAX_PER_MIN: '3' } });
    try {
      const statuses = [];
      for (let i = 0; i < 5; i++) statuses.push((await fetch(`${limited.base}/api/geocode?q=rua%20${i}xx`, { headers: { 'sec-fetch-site': 'same-origin' } })).status);
      assert.deepEqual(statuses, [200, 200, 200, 429, 429]);
    } finally { await limited.stop(); }
  });

  test('Tiles protegidos: exigem origem do próprio site', async () => {
    const r = await fetch(`${srv.base}/tiles/14/6069/9294`);
    assert.equal(r.status, 403);
    const bad = await fetch(`${srv.base}/tiles/3/99/99`, { headers: { 'sec-fetch-site': 'same-origin' } });
    assert.equal(bad.status, 404, 'tile fora da grade é recusado sem ir à internet');
  });

  test('/api/map-check: só para o administrador fora do modo de desenvolvimento', async () => {
    assert.equal((await fetch(`${srv.base}/api/map-check`)).status, 401);
    const u = await registerUser(srv.base);
    assert.equal((await u.get('/api/map-check')).status, 403);
  });

  test('Arquivos estáticos: gzip, ETag/304, 404 para arquivo inexistente e sem path traversal', async () => {
    const gz = await fetch(`${srv.base}/app.js`, { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(gz.headers.get('content-encoding'), 'gzip');
    const plain = await new Promise((resolve, reject) => {
      require('node:http').get(`${srv.base}/app.js`, { headers: { 'accept-encoding': 'gzip' } }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
      }).on('error', reject);
    });
    assert.equal(plain.headers['content-encoding'], 'gzip');
    assert.match(zlib.gunzipSync(plain.body).toString(), /APP_VERSION/);
    const etag = gz.headers.get('etag');
    const cached = await fetch(`${srv.base}/app.js`, { headers: { 'if-none-match': etag } });
    assert.equal(cached.status, 304);
    assert.equal((await fetch(`${srv.base}/nao-existe.js`)).status, 404);
    assert.equal((await fetch(`${srv.base}/painel`)).status, 200, 'rota do app devolve o index.html');
    for (const p of ['/..%2fserver.js', '/%2e%2e/package.json', '/..%5c..%5cserver.js', '/uploads/../foodfind.db', '/api/../db.js']) {
      const r = await fetch(srv.base + p);
      const t = await r.text();
      assert.ok(!t.includes('require(') && !t.includes('SQLite format'), p);
    }
    assert.equal((await fetch(`${srv.base}/sw.js`)).headers.get('service-worker-allowed'), '/');
  });

  test('PWA: manifest, ícones e service worker que não guarda a API', async () => {
    const m = await (await fetch(`${srv.base}/manifest.webmanifest`)).json();
    assert.equal(m.lang, 'pt-BR');
    assert.equal(m.display, 'standalone');
    for (const icon of m.icons) assert.equal((await fetch(srv.base + icon.src)).status, 200, icon.src);
    const sw = await (await fetch(`${srv.base}/sw.js`)).text();
    assert.match(sw, /if \(url\.pathname\.startsWith\('\/api\/'\)[^\n]*\) return;/, 'a API nunca é guardada em cache');
  });

  test('Versão: package.json, README, servidor e front-end usam a mesma versão', async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const v = pkg.version;
    assert.match(v, /^4\.\d+\.\d+$/);
    assert.equal((await (await fetch(`${srv.base}/api/health`)).json()).version, v);
    const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
    assert.ok(html.includes(`app.js?v=${v}`) && html.includes(`styles.css?v=${v}`) && html.includes(`id="appVersion">${v}<`));
    assert.ok(fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8').includes(`const APP_VERSION = '${v}'`));
    assert.ok(fs.readFileSync(path.join(ROOT, 'public/sw.js'), 'utf8').includes(`const VERSION = '${v}'`));
    assert.ok(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').includes(`versão ${v}`));
  });

  test('Erros não derrubam o servidor: JSON inválido, URL estranha e rota inexistente', async () => {
    const bad = await fetch(`${srv.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email":' });
    assert.equal(bad.status, 400);
    assert.equal((await fetch(`${srv.base}/api/nada`)).status, 404);
    assert.equal((await fetch(`${srv.base}/%E0%A4%A`)).status, 400);
    assert.equal((await fetch(`${srv.base}/api/restaurants/ff-1/reviews`, { method: 'PATCH' })).status, 404);
    assert.equal((await fetch(`${srv.base}/api/health`)).status, 200, 'servidor continua no ar');
    assert.equal(srv.child.exitCode, null);
  });

  test('Migração: banco da Sprint 3 (texto puro nos tokens) é convertido sem perder dados', async () => {
    const SQL = await initSqlJs();
    const old = new SQL.Database();
    old.run(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'cliente', created_at TEXT NOT NULL);
      CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, restaurant_id INTEGER NOT NULL, user_id INTEGER NOT NULL, rating INTEGER NOT NULL, comment TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(restaurant_id, user_id));
      CREATE TABLE campaigns (id INTEGER PRIMARY KEY AUTOINCREMENT, restaurant_id INTEGER NOT NULL, owner_id INTEGER NOT NULL, code TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT DEFAULT '', discount_type TEXT NOT NULL, discount_value REAL NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, max_redemptions INTEGER NOT NULL DEFAULT 100, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
      CREATE TABLE redemptions (id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id INTEGER NOT NULL, user_id INTEGER NOT NULL, redeemed_at TEXT NOT NULL, UNIQUE(campaign_id, user_id));
      CREATE TABLE restaurants (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id INTEGER NOT NULL, osm_ref TEXT UNIQUE, name TEXT NOT NULL, category TEXT, cuisine TEXT, description TEXT, website TEXT, phone TEXT, whatsapp TEXT, instagram TEXT, delivery_url TEXT, menu_url TEXT, price_range TEXT, address TEXT, lat REAL NOT NULL, lng REAL NOT NULL, hours TEXT, menu TEXT, photos TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
    const { hashPassword } = require('../lib/security');
    const now = new Date().toISOString();
    const later = new Date(Date.now() + 10 * 86400000).toISOString();
    old.run('INSERT INTO users VALUES (1, ?, ?, ?, ?, ?)', ['Dono Antigo', 'dono@antigo.com', await hashPassword('senha-antiga-1'), 'restaurante', now]);
    old.run('INSERT INTO users VALUES (2, ?, ?, ?, ?, ?)', ['Cliente Antigo', 'cliente@antigo.com', await hashPassword('senha-antiga-2'), 'cliente', now]);
    old.run('INSERT INTO sessions VALUES (?, 2, ?)', ['tokenpuroantigo', Date.now() + 86400000]);
    old.run(`INSERT INTO restaurants VALUES (1, 1, NULL, 'Cantina Antiga', 'Restaurante', '', '', '', '', '', '', '', '', '', '', -23.5613, -46.6565, '{}', '[]', '[]', ?, ?)`, [now, now]);
    old.run("INSERT INTO reviews VALUES (1, 1, 2, 4, 'Bom', ?, ?)", [now, now]);
    old.run("INSERT INTO campaigns VALUES (1, 1, 1, 'abc123def456', 'Antiga', '', 'percent', 10, ?, ?, 100, 1, ?)", [now, later, now]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foodfind-legacy-'));
    fs.mkdirSync(path.join(dir, 'uploads'));
    fs.writeFileSync(path.join(dir, 'foodfind.db'), Buffer.from(old.export()));
    const legacy = await startServer({ dataDir: dir });
    try {
      const stale = client(legacy.base);
      stale.cookie = 'ff_session=tokenpuroantigo';
      assert.equal((await stale.get('/api/auth/me')).json.user, null, 'sessão antiga em texto puro foi descartada');
      const cli = client(legacy.base);
      assert.equal((await cli.post('/api/auth/login', { email: 'cliente@antigo.com', password: 'senha-antiga-2' })).status, 200);
      const rv = (await cli.get('/api/restaurants/ff-1/reviews')).json;
      assert.equal(rv.count, 1);
      assert.equal(rv.mine.comment, 'Bom');
      const redeem = await cli.post('/api/campaigns/redeem', { code: 'ABC123DEF456' });
      assert.equal(redeem.status, 201, 'código antigo continua valendo (sem diferenciar maiúsculas)');
      const owner = client(legacy.base);
      await owner.post('/api/auth/login', { email: 'dono@antigo.com', password: 'senha-antiga-1' });
      const camp = (await owner.get('/api/my/campaigns/1')).json.campaign;
      assert.equal(camp.description, 'Antiga', 'descrição vazia recebe o título');
      assert.equal(camp.redemptionCount, 1);
      const db2 = new SQL.Database(fs.readFileSync(path.join(dir, 'foodfind.db')));
      assert.equal(db2.exec('PRAGMA user_version')[0].values[0][0], 5);
      const fks = db2.exec('PRAGMA foreign_key_list(campaigns)')[0].values;
      assert.ok(fks.some(v => v.includes('restaurants') && v.includes('CASCADE')));
    } finally { await legacy.stop(); }
    // Reabrir o banco já migrado não muda nada.
    const again = await startServer({ dataDir: dir });
    try {
      const c = client(again.base);
      assert.equal((await c.post('/api/auth/login', { email: 'cliente@antigo.com', password: 'senha-antiga-2' })).status, 200);
    } finally { await again.stop(); }
  });

  test('FOODFIND_DATA_DIR: banco e fotos ficam na pasta indicada', async () => {
    assert.ok(fs.existsSync(path.join(srv.dir, 'foodfind.db')));
    assert.ok(fs.existsSync(path.join(srv.dir, 'uploads')));
    assert.ok(!fs.existsSync(path.join(ROOT, 'data', 'foodfind.db')) || process.env.CI !== 'true');
  });

  test('Backup: npm run backup copia a pasta de dados com data e hora', async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'foodfind-bkp-'));
    const { execFileSync } = require('node:child_process');
    const log = execFileSync(process.execPath, [path.join(ROOT, 'scripts/backup.js')], { env: { ...process.env, FOODFIND_DATA_DIR: srv.dir, FOODFIND_BACKUP_DIR: out } }).toString();
    const [folder] = fs.readdirSync(out);
    assert.match(folder, /^foodfind-\d{8}-\d{6}$/);
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/backup.js')], { env: { ...process.env, FOODFIND_DATA_DIR: srv.dir, FOODFIND_BACKUP_DIR: out } });
  assert.ok(fs.readdirSync(out).length === 2, 'segundo backup no mesmo segundo ganha outro nome');
  // Backups dentro da pasta de dados (como no Docker) não entram na cópia.
  const inside = path.join(srv.dir, 'backups');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/backup.js')], { env: { ...process.env, FOODFIND_DATA_DIR: srv.dir, FOODFIND_BACKUP_DIR: inside } });
  const [bk] = fs.readdirSync(inside);
  assert.ok(!fs.existsSync(path.join(inside, bk, 'backups')));
    assert.ok(fs.existsSync(path.join(out, folder, 'foodfind.db')));
    assert.ok(fs.existsSync(path.join(out, folder, 'uploads')));
    assert.match(log, /Backup criado/);
  });

  test('Seed: cria contas, restaurantes, campanhas e avaliações de demonstração', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foodfind-seed-'));
    const { execFileSync } = require('node:child_process');
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/seed.js')], { env: { ...process.env, FOODFIND_DATA_DIR: dir, ADMIN_EMAIL: 'admin@foodfind.local' } });
    const s = await startServer({ dataDir: dir, env: { ADMIN_EMAIL: 'admin@foodfind.local' } });
    try {
      const owner = client(s.base);
      assert.equal((await owner.post('/api/auth/login', { email: 'restaurante@foodfind.local', password: 'FoodFind@2026' })).status, 200);
      const camps = (await owner.get('/api/my/campaigns')).json.campaigns;
      assert.deepEqual(camps.map(c => c.status).sort(), ['agendada', 'ativa', 'pausada']);
      const admin = client(s.base);
      const a = await admin.post('/api/auth/login', { email: 'admin@foodfind.local', password: 'FoodFind@2026' });
      assert.equal(a.json.user.isAdmin, true);
      const list = (await client(s.base).get('/api/restaurants?lat=-23.5613&lng=-46.6565')).json.restaurants.filter(r => r.registered);
      assert.equal(list.length, 3);
      assert.ok(list.every(r => r.rating && r.photos.length === 2));
      // Com o servidor no ar, o seed se recusa a gravar (evita perder dados).
      const blocked = require('node:child_process').spawnSync(process.execPath, [path.join(ROOT, 'scripts/seed.js'), '--reset'], { env: { ...process.env, FOODFIND_DATA_DIR: dir } });
      assert.equal(blocked.status, 2);
      assert.match(blocked.stderr.toString(), /Pare o servidor/);
    } finally { await s.stop(); }
    assert.ok(!fs.existsSync(path.join(dir, 'foodfind.lock')), 'trava liberada no encerramento (SIGTERM)');
    assert.ok(uniqueEmail());
  });
});
