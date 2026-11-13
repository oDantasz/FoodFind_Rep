// Painel do restaurante, busca/filtros, OpenStreetMap (simulado e fora do ar),
// links maliciosos e reivindicação de restaurante (servidor real).
const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, registerUser, restaurantBody, createRestaurant, uniqueEmail } = require('./_helpers');

describe('Restaurantes, busca e reivindicação', () => {
  let srv, admin;
  before(async () => {
    srv = await startServer();
    admin = client(srv.base);
    const r = await admin.post('/api/auth/login', { email: 'admin@teste.local', password: 'admin-senha-123' });
    assert.equal(r.status, 200);
    assert.equal(r.json.user.isAdmin, true);
  });
  after(async () => { await srv.stop(); });

  test('HU4.1 painel: só contas Restaurante gerenciam restaurantes', async () => {
    assert.equal((await client(srv.base).get('/api/my/restaurants')).status, 401);
    const cli = await registerUser(srv.base);
    assert.equal((await cli.get('/api/my/restaurants')).status, 403);
    assert.equal((await cli.post('/api/my/restaurants', restaurantBody())).status, 403);
  });

  test('HU4.1 painel: cria, lista, edita e exclui o próprio restaurante', async () => {
    const owner = await registerUser(srv.base, { role: 'restaurante' });
    const r = await createRestaurant(owner, { name: 'Cantina CRUD' });
    assert.equal(r.name, 'Cantina CRUD');
    assert.equal(r.menu[0].price, 42.9);
    const list = await owner.get('/api/my/restaurants');
    assert.equal(list.json.restaurants.length, 1);
    const upd = await owner.put(`/api/my/restaurants/${r.id}`, restaurantBody({ name: 'Cantina Editada', priceRange: '$$$' }));
    assert.equal(upd.status, 200);
    assert.equal(upd.json.restaurant.name, 'Cantina Editada');
    const pub = await client(srv.base).get(`/api/restaurants/ff-${r.id}`);
    assert.equal(pub.json.restaurant.name, 'Cantina Editada');
    assert.equal(pub.json.restaurant.registered, true);
    // Outro dono não edita nem exclui.
    const other = await registerUser(srv.base, { role: 'restaurante' });
    assert.equal((await other.put(`/api/my/restaurants/${r.id}`, restaurantBody())).status, 404);
    assert.equal((await other.del(`/api/my/restaurants/${r.id}`)).status, 404);
    assert.equal((await owner.del(`/api/my/restaurants/${r.id}`)).status, 200);
    assert.equal((await client(srv.base).get(`/api/restaurants/ff-${r.id}`)).status, 404);
  });

  test('HU4.1 validação: nome e localização obrigatórios', async () => {
    const owner = await registerUser(srv.base, { role: 'restaurante' });
    assert.equal((await owner.post('/api/my/restaurants', restaurantBody({ name: ' ' }))).status, 400);
    assert.equal((await owner.post('/api/my/restaurants', restaurantBody({ lat: 'x' }))).status, 400);
    assert.equal((await owner.post('/api/my/restaurants', restaurantBody({ lat: 0, lng: 0 }))).status, 400);
  });

  test('Links maliciosos: javascript: e data: são recusados no cadastro', async () => {
    const owner = await registerUser(srv.base, { role: 'restaurante' });
    for (const website of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'JaVaScRiPt:alert(1)', 'vbscript:msgbox', 'https://user:senha@site.com']) {
      const r = await owner.post('/api/my/restaurants', restaurantBody({ website }));
      assert.equal(r.status, 400, website);
    }
    assert.equal((await owner.post('/api/my/restaurants', restaurantBody({ deliveryUrl: 'javascript:alert(1)' }))).status, 400);
    assert.equal((await owner.post('/api/my/restaurants', restaurantBody({ menuUrl: 'data:text/html,oi' }))).status, 400);
    assert.equal((await owner.post('/api/my/restaurants', restaurantBody({ instagram: 'https://evil.com/instagram.com' }))).status, 400);
    const ok = await createRestaurant(owner, { website: 'meurestaurante.com.br', instagram: '@meu.rest' });
    assert.equal(ok.website, 'https://meurestaurante.com.br/');
    assert.equal(ok.instagram, 'https://instagram.com/meu.rest');
  });

  test('Links maliciosos vindos do OpenStreetMap são removidos antes de ir para o front', async () => {
    const r = await client(srv.base).get('/api/restaurants?lat=-23.5613&lng=-46.6565');
    const bar = r.json.restaurants.find(x => x.id === 'node-1002');
    const padaria = r.json.restaurants.find(x => x.id === 'way-2001');
    assert.equal(bar.website, '');
    assert.equal(bar.phone, 'Telefone não informado');
    assert.equal(padaria.website, '');
    assert.ok(!/javascript:|data:/i.test(r.text), 'nenhuma URL perigosa na resposta');
    const ok = r.json.restaurants.find(x => x.id === 'node-1001');
    assert.equal(ok.website, 'https://mapa-aberto.example.com/');
  });

  test('HU2.1 busca: junta OSM + cadastrados, ordena por distância e respeita o raio', async () => {
    const owner = await registerUser(srv.base, { role: 'restaurante' });
    await createRestaurant(owner, { name: 'Temakeria Busca Única', menu: [{ section: 'Temakis', name: 'Temaki especial', price: 30 }] });
    const r = await client(srv.base).get('/api/restaurants?lat=-23.5613&lng=-46.6565');
    assert.equal(r.status, 200);
    assert.equal(r.json.warning, '');
    const ids = r.json.restaurants.map(x => x.id);
    assert.ok(ids.includes('node-1001'));
    assert.ok(!ids.includes('node-1005'), 'fora do raio não aparece');
    assert.ok(r.json.restaurants.some(x => x.registered && x.name === 'Temakeria Busca Única'));
    const dists = r.json.restaurants.map(x => x.distanceKm);
    assert.deepEqual(dists, [...dists].sort((a, b) => a - b));
    // Busca por item do cardápio.
    const q = await client(srv.base).get('/api/restaurants?lat=-23.5613&lng=-46.6565&q=temaki%20especial');
    assert.deepEqual(q.json.restaurants.map(x => x.name), ['Temakeria Busca Única']);
  });

  test('HU2.1 filtros: categorias do OSM (bar, padaria, sorveteria, pizzaria), preço, aberto agora, nota mínima e ordenação', async () => {
    const base = '/api/restaurants?lat=-23.5613&lng=-46.6565';
    const cat = async c => (await client(srv.base).get(`${base}&category=${encodeURIComponent(c)}`)).json.restaurants.map(x => x.id);
    assert.ok((await cat('Bar')).includes('node-1002'));
    assert.ok((await cat('Padaria')).includes('way-2001'));
    assert.ok((await cat('Sorveteria')).includes('node-1003'));
    assert.ok((await cat('Pizzaria')).includes('node-1004'));
    // Várias categorias de uma vez (chips): traz as duas e nada além delas; valor inválido é ignorado.
    const multi = (await client(srv.base).get(`${base}&category=${encodeURIComponent('Bar,Pizzaria,Inexistente')}`)).json;
    assert.ok(multi.restaurants.some(x => x.id === 'node-1002') && multi.restaurants.some(x => x.id === 'node-1004'));
    assert.ok(multi.restaurants.every(x => x.category === 'Bar' || x.category === 'Pizzaria'));
    assert.equal(multi.filters.category, 'Bar,Pizzaria');
    const owner = await registerUser(srv.base, { role: 'restaurante' });
    await createRestaurant(owner, { name: 'Caro Demais', priceRange: '$$$$' });
    const price = (await client(srv.base).get(`${base}&price=%24%24%24%24`)).json.restaurants;
    assert.ok(price.length >= 1 && price.every(x => x.priceRange === '$$$$'));
    const open = (await client(srv.base).get(`${base}&open=1`)).json.restaurants;
    assert.ok(open.some(x => x.id === 'node-1001'), 'OSM 24/7 está aberto');
    assert.ok(!open.some(x => x.id === 'node-1002'), 'OSM "off" está fechado');
    assert.ok(open.every(x => x.openNow === true));
    const rated = (await client(srv.base).get(`${base}&minRating=4`)).json.restaurants;
    assert.ok(rated.every(x => x.rating >= 4));
    const byName = (await client(srv.base).get(`${base}&sort=name`)).json.restaurants.map(x => x.name);
    assert.deepEqual(byName, [...byName].sort((a, b) => a.localeCompare(b, 'pt-BR')));
    const small = (await client(srv.base).get(`${base}&radius=0.5`)).json;
    assert.equal(small.radiusKm, 0.5);
    assert.ok(small.restaurants.every(x => x.distanceKm <= 0.5));
  });

  test('OSM fora do ar: a API responde só com os cadastrados e avisa', async () => {
    const offline = await startServer({ osm: false });
    try {
      const owner = await registerUser(offline.base, { role: 'restaurante' });
      await createRestaurant(owner, { name: 'Sobrevivente Offline' });
      const r = await client(offline.base).get('/api/restaurants?lat=-23.5613&lng=-46.6565');
      assert.equal(r.status, 200);
      assert.match(r.json.warning, /OpenStreetMap não respondeu/);
      assert.deepEqual(r.json.restaurants.map(x => x.name), ['Sobrevivente Offline']);
    } finally { await offline.stop(); }
  });

  test('OSM ocupado (200 com "remark" de erro) não vira lista vazia silenciosa', async () => {
    srv.mock.state.remark = true;
    try {
      const r = await client(srv.base).get('/api/restaurants?lat=-23.5000&lng=-46.6000');
      assert.equal(r.status, 200);
      assert.match(r.json.warning, /OpenStreetMap não respondeu/);
    } finally { srv.mock.state.remark = false; }
    const ok = await client(srv.base).get('/api/restaurants?lat=-23.5001&lng=-46.6001&radius=10');
    assert.equal(ok.json.warning, '');
  });

  test('OSM fora do ar depois de uma busca: usa a última consulta da região (inclusive após reiniciar)', async () => {
    const first = await client(srv.base).get('/api/restaurants?lat=-23.5613&lng=-46.6565');
    assert.ok(first.json.restaurants.some(x => x.id === 'node-1001'));
    srv.mock.state.remark = true;
    try {
      const r = await client(srv.base).get('/api/restaurants?lat=-23.5625&lng=-46.6580');
      assert.match(r.json.warning, /última consulta/);
      assert.ok(r.json.restaurants.some(x => x.id === 'node-1001'), 'lugares do cache aparecem');
    } finally { srv.mock.state.remark = false; }
    await new Promise(res => setTimeout(res, 700)); // cache gravado em disco
    const fs = require('node:fs');
    const path = require('node:path');
    const copy = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'foodfind-cache-'));
    fs.copyFileSync(path.join(srv.dir, 'osm-cache.json'), path.join(copy, 'osm-cache.json'));
    const offline = await startServer({ dataDir: copy, osm: false });
    try {
      const r = await client(offline.base).get('/api/restaurants?lat=-23.5630&lng=-46.6590');
      assert.match(r.json.warning, /última consulta/);
      assert.ok(r.json.restaurants.some(x => x.id === 'node-1001'));
    } finally { await offline.stop(); }
  });

  test('Perfil de lugar do OSM por id (F5 em #/restaurante/node-1001)', async () => {
    const r = await client(srv.base).get('/api/restaurants/node-1001');
    assert.equal(r.status, 200);
    assert.equal(r.json.restaurant.name, 'Restaurante Mapa Aberto');
    assert.equal(r.json.restaurant.registered, false);
    assert.equal((await client(srv.base).get('/api/restaurants/node-999999')).status, 404);
    assert.equal((await client(srv.base).get('/api/restaurants/ff-999999')).status, 404);
  });

  test('Reivindicação: pedido pendente, sem edição até aprovar; admin aprova e o dono passa a editar', async () => {
    const owner = await registerUser(srv.base, { role: 'restaurante' });
    // Não pode criar direto com osmRef.
    assert.equal((await owner.post('/api/my/restaurants', restaurantBody({ osmRef: 'node-1001' }))).json.code, 'use_claim');
    const claim = await owner.post('/api/my/claims', restaurantBody({ osmRef: 'node-1001', name: 'Restaurante Mapa Aberto', message: 'Sou o dono, CNPJ 00.000.000/0001-00' }));
    assert.equal(claim.status, 201);
    assert.equal(claim.json.claim.status, 'pendente');
    // Pendente: nada no painel, restaurante continua sendo do OSM.
    assert.equal((await owner.get('/api/my/restaurants')).json.restaurants.length, 0);
    assert.equal((await client(srv.base).get('/api/restaurants/node-1001')).json.restaurant.registered, false);
    // Pedido duplicado e de outro dono são bloqueados.
    assert.equal((await owner.post('/api/my/claims', restaurantBody({ osmRef: 'node-1001' }))).json.code, 'claim_pending');
    const rival = await registerUser(srv.base, { role: 'restaurante' });
    assert.equal((await rival.post('/api/my/claims', restaurantBody({ osmRef: 'node-1001' }))).status, 409);
    // Só o administrador decide.
    assert.equal((await owner.post(`/api/admin/claims/${claim.json.claim.id}/approve`)).status, 403);
    assert.equal((await owner.get('/api/admin/claims')).status, 403);
    const pend = await admin.get('/api/admin/claims?status=pendente');
    assert.ok(pend.json.claims.some(c => c.id === claim.json.claim.id && c.requester.email === owner.email));
    const ok = await admin.post(`/api/admin/claims/${claim.json.claim.id}/approve`);
    assert.equal(ok.status, 200);
    assert.equal(ok.json.claim.status, 'aprovado');
    assert.equal((await admin.post(`/api/admin/claims/${claim.json.claim.id}/approve`)).status, 409);
    // Agora é do dono e substitui o lugar do OSM.
    const mine = (await owner.get('/api/my/restaurants')).json.restaurants;
    assert.equal(mine.length, 1);
    assert.equal(mine[0].osmRef, 'node-1001');
    const edited = await owner.put(`/api/my/restaurants/${mine[0].id}`, restaurantBody({ name: 'Mapa Aberto (oficial)' }));
    assert.equal(edited.status, 200);
    const search = (await client(srv.base).get('/api/restaurants?lat=-23.5613&lng=-46.6565')).json.restaurants;
    assert.ok(!search.some(x => x.id === 'node-1001'), 'versão do OSM some da busca');
    assert.ok(search.some(x => x.name === 'Mapa Aberto (oficial)'));
    assert.equal((await client(srv.base).get('/api/restaurants/node-1001')).json.restaurant.id, `ff-${mine[0].id}`);
    assert.equal((await owner.post('/api/my/claims', restaurantBody({ osmRef: 'node-1001' }))).json.code, 'already_claimed');
  });

  test('Reivindicação: recusa com motivo e cancelamento de pedido pendente', async () => {
    const owner = await registerUser(srv.base, { role: 'restaurante' });
    const c1 = (await owner.post('/api/my/claims', restaurantBody({ osmRef: 'node-1003', name: 'Sorvetes OSM' }))).json.claim;
    const rej = await admin.post(`/api/admin/claims/${c1.id}/reject`, { reason: 'Não confirmamos o telefone.' });
    assert.equal(rej.json.claim.status, 'recusado');
    const mine = (await owner.get('/api/my/claims')).json.claims.find(c => c.id === c1.id);
    assert.equal(mine.reason, 'Não confirmamos o telefone.');
    assert.equal((await owner.get('/api/my/restaurants')).json.restaurants.length, 0);
    const c2 = (await owner.post('/api/my/claims', restaurantBody({ osmRef: 'node-1003', name: 'Sorvetes OSM' }))).json.claim;
    assert.equal((await owner.del(`/api/my/claims/${c2.id}`)).status, 200);
    assert.equal((await owner.del(`/api/my/claims/${c1.id}`)).status, 409, 'pedido já analisado não é cancelado');
  });

  test('Administrador redefine a senha de um usuário (alternativa à recuperação por e-mail)', async () => {
    const u = await registerUser(srv.base);
    const r = await admin.post('/api/admin/users/reset-password', { email: u.email });
    assert.equal(r.status, 200);
    assert.ok(r.json.temporaryPassword.length >= 12);
    assert.equal((await u.get('/api/auth/me')).json.user, null, 'sessões antigas encerradas');
    assert.equal((await client(srv.base).post('/api/auth/login', { email: u.email, password: u.password })).status, 401);
    assert.equal((await client(srv.base).post('/api/auth/login', { email: u.email, password: r.json.temporaryPassword })).status, 200);
    assert.equal((await u.post('/api/admin/users/reset-password', { email: uniqueEmail() })).status, 401);
  });
});
