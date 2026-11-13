// Avaliações: permissões, duplicidade, média, edição, exclusão, paginação e OSM (servidor real).
const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, registerUser, createRestaurant, restaurantBody } = require('./_helpers');

describe('Avaliações', () => {
  let srv, owner, rest;
  before(async () => {
    srv = await startServer();
    owner = await registerUser(srv.base, { role: 'restaurante' });
    rest = await createRestaurant(owner, { name: 'Bistrô Avaliado' });
  });
  after(async () => { await srv.stop(); });

  const reviewsUrl = id => `/api/restaurants/${id}/reviews`;

  test('HU2.2 permissões: visitante 401, conta Restaurante 403', async () => {
    const anon = await client(srv.base).post(reviewsUrl(`ff-${rest.id}`), { rating: 5 });
    assert.equal(anon.status, 401);
    const r = await owner.post(reviewsUrl(`ff-${rest.id}`), { rating: 5 });
    assert.equal(r.status, 403);
    assert.equal(r.json.code, 'not_client');
    const list = await owner.get(reviewsUrl(`ff-${rest.id}`));
    assert.equal(list.json.canReview, false);
    assert.match(list.json.reason, /Restaurante não avaliam/);
  });

  test('HU2.2 validação: nota inteira de 1 a 5 e comentário de até 600 caracteres', async () => {
    const c = await registerUser(srv.base);
    for (const rating of [0, 6, 2.5, 'abc', null]) assert.equal((await c.post(reviewsUrl(`ff-${rest.id}`), { rating })).status, 400, String(rating));
    const long = await c.post(reviewsUrl(`ff-${rest.id}`), { rating: 4, comment: 'x'.repeat(601) });
    assert.equal(long.status, 400);
    assert.equal(long.json.code, 'comment_too_long');
    assert.equal((await c.post(reviewsUrl(`ff-${rest.id}`), { rating: 4, comment: 'x'.repeat(600) })).status, 201);
    assert.equal((await c.post(reviewsUrl('ff-999999'), { rating: 4 })).status, 404);
  });

  test('HU2.2 uma avaliação por cliente: reenviar atualiza; média, contagem e distribuição', async () => {
    const r2 = await createRestaurant(owner, { name: 'Média Certa' });
    const a = await registerUser(srv.base, { name: 'Ana Beatriz Souza' });
    const b = await registerUser(srv.base, { name: 'Bruno Lima' });
    assert.equal((await a.post(reviewsUrl(`ff-${r2.id}`), { rating: 5, comment: 'Ótimo' })).status, 201);
    assert.equal((await b.post(reviewsUrl(`ff-${r2.id}`), { rating: 2 })).status, 201);
    const again = await a.post(reviewsUrl(`ff-${r2.id}`), { rating: 4, comment: 'Bom' });
    assert.equal(again.status, 200);
    assert.equal(again.json.created, false);
    const list = await client(srv.base).get(reviewsUrl(`ff-${r2.id}`));
    assert.equal(list.json.count, 2);
    assert.equal(list.json.average, 3);
    assert.deepEqual(list.json.distribution, { 1: 0, 2: 1, 3: 0, 4: 1, 5: 0 });
    assert.deepEqual(list.json.reviews.map(r => r.author).sort(), ['Ana S.', 'Bruno L.']);
    assert.ok(!list.text.includes('Beatriz'), 'nome completo não é exposto');
    assert.ok(!list.text.includes('@'), 'e-mail não é exposto');
    // Nota aparece na busca, no perfil e no painel do dono.
    const search = (await client(srv.base).get('/api/restaurants?lat=-23.5613&lng=-46.6565')).json.restaurants.find(x => x.id === `ff-${r2.id}`);
    assert.equal(search.rating, 3);
    assert.equal(search.reviewCount, 2);
    const profile = (await client(srv.base).get(`/api/restaurants/ff-${r2.id}`)).json.restaurant;
    assert.equal(profile.rating, 3);
    const panel = (await owner.get('/api/my/restaurants')).json.restaurants.find(x => x.id === r2.id);
    assert.equal(panel.reviewCount, 2);
    const min4 = (await client(srv.base).get('/api/restaurants?lat=-23.5613&lng=-46.6565&minRating=4')).json.restaurants;
    assert.ok(!min4.some(x => x.id === `ff-${r2.id}`));
    const best = (await client(srv.base).get('/api/restaurants?lat=-23.5613&lng=-46.6565&sort=rating')).json.restaurants;
    const ratings = best.map(x => x.rating || 0);
    assert.deepEqual(ratings, [...ratings].sort((x, y) => y - x));
  });

  test('HU2.2 ver, editar (formulário preenchido) e excluir a própria avaliação', async () => {
    const r3 = await createRestaurant(owner, { name: 'Editável' });
    const c = await registerUser(srv.base);
    const mineUrl = `${reviewsUrl(`ff-${r3.id}`)}/mine`;
    assert.equal((await c.get(mineUrl)).json.review, null);
    assert.equal((await c.del(mineUrl)).status, 404);
    assert.equal((await c.put(mineUrl, { rating: 3, comment: 'Primeira' })).status, 201);
    const mine = (await c.get(mineUrl)).json.review;
    assert.equal(mine.rating, 3);
    assert.equal(mine.comment, 'Primeira');
    const listMine = (await c.get(reviewsUrl(`ff-${r3.id}`))).json;
    assert.equal(listMine.mine.comment, 'Primeira', 'a lista traz a avaliação do usuário para preencher o formulário');
    assert.equal(listMine.reviews[0].mine, true);
    const upd = await c.put(mineUrl, { rating: 5, comment: 'Editada' });
    assert.equal(upd.status, 200);
    assert.equal(upd.json.review.comment, 'Editada');
    assert.equal(upd.json.average, 5);
    const del = await c.del(mineUrl);
    assert.equal(del.status, 200);
    assert.equal(del.json.count, 0);
    assert.equal((await c.get(mineUrl)).json.review, null);
    // Outro cliente não apaga a avaliação alheia (a rota só mexe na própria).
    await c.put(mineUrl, { rating: 4 });
    const other = await registerUser(srv.base);
    assert.equal((await other.del(mineUrl)).status, 404);
    assert.equal((await client(srv.base).get(reviewsUrl(`ff-${r3.id}`))).json.count, 1);
  });

  test('HU2.2 paginação da mais recente para a mais antiga', async () => {
    const r4 = await createRestaurant(owner, { name: 'Muitas Avaliações' });
    for (let i = 1; i <= 7; i++) {
      const c = await registerUser(srv.base, { name: `Cliente Numero${i}` });
      await c.post(reviewsUrl(`ff-${r4.id}`), { rating: (i % 5) + 1, comment: `Comentário ${i}` });
      await new Promise(r => setTimeout(r, 5));
    }
    const p1 = (await client(srv.base).get(`${reviewsUrl(`ff-${r4.id}`)}?page=1&limit=5`)).json;
    const p2 = (await client(srv.base).get(`${reviewsUrl(`ff-${r4.id}`)}?page=2&limit=5`)).json;
    assert.equal(p1.pages, 2);
    assert.equal(p1.reviews.length, 5);
    assert.equal(p2.reviews.length, 2);
    assert.equal(p1.reviews[0].comment, 'Comentário 7');
    assert.equal(p2.reviews[1].comment, 'Comentário 1');
    const all = [...p1.reviews, ...p2.reviews].map(r => r.updatedAt);
    assert.deepEqual(all, [...all].sort().reverse());
  });

  test('HU2.2 restaurantes do OpenStreetMap podem ser avaliados e mantêm as notas quando assumidos', async () => {
    const c = await registerUser(srv.base, { name: 'Olivia Mapa' });
    const r = await c.post(reviewsUrl('node-1004'), { rating: 4, comment: 'Pizza boa' });
    assert.equal(r.status, 201);
    assert.equal(r.json.average, 4);
    assert.equal((await c.post(reviewsUrl('node-777777'), { rating: 4 })).status, 404, 'lugar inexistente no OSM');
    const search = (await client(srv.base).get('/api/restaurants?lat=-23.5613&lng=-46.6565')).json.restaurants.find(x => x.id === 'node-1004');
    assert.equal(search.rating, 4);
    assert.equal(search.reviewCount, 1);
    // Dono assume o lugar; a avaliação antiga continua valendo no perfil cadastrado.
    const admin = client(srv.base);
    await admin.post('/api/auth/login', { email: 'admin@teste.local', password: 'admin-senha-123' });
    const dono = await registerUser(srv.base, { role: 'restaurante' });
    const claim = (await dono.post('/api/my/claims', restaurantBody({ osmRef: 'node-1004', name: 'Pizzaria do Mapa' }))).json.claim;
    const approved = await admin.post(`/api/admin/claims/${claim.id}/approve`);
    const ffId = approved.json.restaurantId;
    const list = (await client(srv.base).get(reviewsUrl(ffId))).json;
    assert.equal(list.count, 1);
    assert.equal(list.reviews[0].comment, 'Pizza boa');
    assert.equal((await client(srv.base).get(`/api/restaurants/${ffId}`)).json.restaurant.rating, 4);
    // Nova avaliação pelo perfil cadastrado atualiza a mesma (uma por cliente).
    assert.equal((await c.post(reviewsUrl(ffId), { rating: 2 })).status, 200);
    assert.equal((await client(srv.base).get(reviewsUrl('node-1004'))).json.average, 2);
    // Se o dono excluir o perfil, as avaliações do lugar continuam.
    const mine = (await dono.get('/api/my/restaurants')).json.restaurants[0];
    await dono.del(`/api/my/restaurants/${mine.id}`);
    assert.equal((await client(srv.base).get(reviewsUrl('node-1004'))).json.count, 1);
  });

  test('Excluir restaurante criado no FoodFind apaga as avaliações dele', async () => {
    const r5 = await createRestaurant(owner, { name: 'Vai Sumir' });
    const c = await registerUser(srv.base);
    await c.post(reviewsUrl(`ff-${r5.id}`), { rating: 5 });
    assert.equal((await owner.del(`/api/my/restaurants/${r5.id}`)).status, 200);
    assert.equal((await c.get(`${reviewsUrl(`ff-${r5.id}`)}/mine`)).status, 404);
    const exp = (await c.get('/api/me/export')).json;
    assert.ok(!exp.avaliacoes.some(a => a.referencia === `ff-${r5.id}`));
  });
});
