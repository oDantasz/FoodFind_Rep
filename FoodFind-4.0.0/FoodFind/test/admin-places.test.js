// Administração: estabelecimentos do mapa (inclusive os sem nome), cadastro pelo administrador
// e transferência para o dono quando ele pede para assumir.
const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, registerUser, restaurantBody, createRestaurant } = require('./_helpers');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const AREA = 'lat=-23.5613&lng=-46.6565';

describe('Administração: estabelecimentos', () => {
  let srv, admin;
  before(async () => {
    srv = await startServer();
    admin = client(srv.base);
    assert.equal((await admin.post('/api/auth/login', { email: 'admin@teste.local', password: 'admin-senha-123' })).status, 200);
  });
  after(async () => { await srv.stop(); });

  test('Só o administrador vê a lista com os sem nome (visitante 401, outras contas 403)', async () => {
    assert.equal((await client(srv.base).get(`/api/admin/places?${AREA}`)).status, 401);
    const owner = await registerUser(srv.base, { role: 'restaurante' });
    assert.equal((await owner.get(`/api/admin/places?${AREA}`)).status, 403);
    assert.equal((await owner.post('/api/admin/places', { ...restaurantBody(), osmRef: 'node-1006' })).status, 403);
  });

  test('A lista do administrador inclui o lugar sem nome; a pública não', async () => {
    const all = await admin.get(`/api/admin/places?${AREA}`);
    assert.equal(all.status, 200);
    const unnamed = all.json.restaurants.find(r => r.id === 'node-1006');
    assert.ok(unnamed, 'o bar sem nome aparece para o administrador');
    assert.equal(unnamed.unnamed, true);
    assert.ok(all.json.restaurants.some(r => r.id === 'node-1001'), 'os com nome também aparecem');

    const onlyUnnamed = await admin.get(`/api/admin/places?${AREA}&show=unnamed`);
    assert.deepEqual(onlyUnnamed.json.restaurants.map(r => r.id), ['node-1006']);

    const pub = await client(srv.base).get(`/api/restaurants?${AREA}`);
    assert.ok(!pub.json.restaurants.some(r => r.id === 'node-1006'));
    // Mesmo o administrador, na tela padrão, vê só os com nome.
    assert.ok(!(await admin.get(`/api/restaurants?${AREA}`)).json.restaurants.some(r => r.id === 'node-1006'));
  });

  test('Lápis: o administrador completa o nome e cadastra no FoodFind; o lugar passa a aparecer para todos', async () => {
    const up = await admin.post('/api/uploads', { dataUrl: PNG });
    assert.equal(up.status, 201, 'o administrador pode enviar fotos');
    const r = await admin.post('/api/admin/places', { ...restaurantBody({ name: 'Bar do Seu Zé', category: 'Bar', photos: [up.json.url], lat: -23.5612, lng: -46.6561 }), osmRef: 'node-1006' });
    assert.equal(r.status, 201);
    assert.equal(r.json.restaurant.osmRef, 'node-1006');

    assert.equal((await admin.post('/api/admin/places', { ...restaurantBody(), osmRef: 'node-1006' })).status, 409, 'não cadastra duas vezes');
    assert.equal((await admin.post('/api/admin/places', { ...restaurantBody(), osmRef: 'nada' })).status, 400);

    const pub = await client(srv.base).get(`/api/restaurants?${AREA}`);
    const listed = pub.json.restaurants.filter(x => x.name === 'Bar do Seu Zé');
    assert.equal(listed.length, 1);
    assert.equal(listed[0].registered, true);
    assert.equal(listed[0].adminOwned, true);
    assert.ok(!pub.json.restaurants.some(x => x.id === 'node-1006'), 'o ponto do mapa é substituído pelo cadastro');

    const detail = await client(srv.base).get('/api/restaurants/node-1006');
    assert.equal(detail.json.restaurant.name, 'Bar do Seu Zé');

    const reg = await admin.get(`/api/admin/places?${AREA}&show=registered`);
    assert.ok(reg.json.restaurants.some(x => x.name === 'Bar do Seu Zé'));
  });

  test('O administrador edita qualquer restaurante, mas só desfaz os cadastros dele', async () => {
    const owner = await registerUser(srv.base, { role: 'restaurante' });
    const theirs = await createRestaurant(owner, { name: 'Restaurante Do Dono' });
    const got = await admin.get(`/api/admin/restaurants/${theirs.id}`);
    assert.equal(got.status, 200);
    assert.equal(got.json.restaurant.adminOwned, false);
    const put = await admin.put(`/api/admin/restaurants/${theirs.id}`, restaurantBody({ name: 'Restaurante Do Dono (corrigido)' }));
    assert.equal(put.status, 200);
    assert.equal(put.json.restaurant.name, 'Restaurante Do Dono (corrigido)');
    assert.equal((await owner.get('/api/my/restaurants')).json.restaurants[0].name, 'Restaurante Do Dono (corrigido)', 'continua sendo do dono');
    assert.equal((await admin.del(`/api/admin/restaurants/${theirs.id}`)).status, 403);
  });

  test('Desfazer o cadastro: o lugar volta a ser o ponto do mapa', async () => {
    const r = await admin.post('/api/admin/places', { ...restaurantBody({ name: 'Pizzaria Cadastrada Pelo Admin' }), osmRef: 'node-1004' });
    assert.equal(r.status, 201);
    assert.equal((await admin.del(`/api/admin/restaurants/${r.json.restaurant.id}`)).status, 200);
    const pub = await client(srv.base).get(`/api/restaurants?${AREA}`);
    assert.ok(pub.json.restaurants.some(x => x.id === 'node-1004' && x.name === 'Pizzaria do Mapa'));
  });

  test('O dono pede para assumir um lugar cadastrado pelo administrador e, aprovado, passa a gerenciá-lo com as fotos', async () => {
    const owner = await registerUser(srv.base, { role: 'restaurante' });
    const detail = await owner.get('/api/restaurants/node-1006');
    assert.equal(detail.json.restaurant.adminOwned, true);
    assert.equal(detail.json.restaurant.claimPending, false, 'o dono vê a opção de pedir para assumir');

    const claim = await owner.post('/api/my/claims', { ...restaurantBody({ name: 'Bar do Seu Zé' }), osmRef: 'node-1006', message: 'Sou o dono' });
    assert.equal(claim.status, 201);
    const ok = await admin.post(`/api/admin/claims/${claim.json.claim.id}/approve`, {});
    assert.equal(ok.status, 200);

    const mine = (await owner.get('/api/my/restaurants')).json.restaurants;
    assert.equal(mine.length, 1);
    assert.equal(mine[0].osmRef, 'node-1006');
    assert.equal(mine[0].photos.length, 1, 'a foto enviada pelo administrador continua');
    const photo = mine[0].photos[0];
    // O dono consegue salvar mantendo a foto (ela passou a ser dele).
    const save = await owner.put(`/api/my/restaurants/${mine[0].id}`, restaurantBody({ name: 'Bar do Seu Zé', photos: [photo] }));
    assert.equal(save.status, 200);
    assert.deepEqual(save.json.restaurant.photos, [photo]);
    assert.equal((await fetch(srv.base + photo)).status, 200);

    const pub = (await client(srv.base).get('/api/restaurants/node-1006')).json.restaurant;
    assert.equal(pub.adminOwned, false);
    assert.equal(pub.ownerId, owner.user.id);
  });
});
