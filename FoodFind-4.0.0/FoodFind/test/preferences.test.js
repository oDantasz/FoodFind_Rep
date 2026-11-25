// Preferências e restrições alimentares: cadastro com consentimento (LGPD), opções do restaurante,
// busca "Para você" (compatíveis primeiro) e filtro que esconde o que não combina.
const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const initSqlJs = require('sql.js');
const { startServer, client, registerUser, createRestaurant } = require('./_helpers');

const AREA = 'lat=-23.5613&lng=-46.6565';
const VEG_SEM_GLUTEN = { style: 'vegetarian', allergies: ['gluten'], restrictions: [], cuisines: ['japonesa'], prices: [], sensitiveConsent: true };

describe('Preferências e restrições alimentares', () => {
  let srv, owner, sushi, pizza;
  before(async () => {
    srv = await startServer();
    owner = await registerUser(srv.base, { role: 'restaurante' });
    sushi = await createRestaurant(owner, { name: 'Sushi Verde', cuisine: 'japonesa, sushi', lat: -23.5650, lng: -46.6600, diets: ['vegetarian', 'gluten_free', 'inventado'], menu: [{ section: 'Temakis', name: 'Temaki de pepino', price: 20 }] });
    pizza = await createRestaurant(owner, { name: 'Pizza Sem Opção', category: 'Pizzaria', cuisine: 'pizza', lat: -23.5614, lng: -46.6566, diets: [] });
  });
  after(async () => { await srv.stop(); });

  test('Opções públicas: estilos, alergias, restrições, culinárias e o que o restaurante oferece', async () => {
    const r = await client(srv.base).get('/api/food-options');
    assert.equal(r.status, 200);
    for (const k of ['styles', 'allergies', 'restrictions', 'cuisines', 'offers', 'prices']) assert.ok(r.json[k].length > 0, k);
    assert.ok(r.json.styles.some(s => s.key === 'vegan'));
    assert.ok(r.json.allergies.some(a => a.key === 'peanut'));
    assert.ok(r.json.restrictions.find(x => x.key === 'halal').hard);
    assert.ok(!JSON.stringify(r.json).includes('words'), 'palavras-chave internas não vão para o front');
  });

  test('Dados sensíveis só são gravados com autorização; gostos não precisam', async () => {
    assert.equal((await client(srv.base).put('/api/me/preferences', VEG_SEM_GLUTEN)).status, 401);
    const c = await registerUser(srv.base);
    const semConsent = await c.put('/api/me/preferences', { ...VEG_SEM_GLUTEN, sensitiveConsent: false });
    assert.equal(semConsent.status, 400);
    assert.equal(semConsent.json.code, 'consent_required');
    assert.equal((await c.get('/api/me/preferences')).json.preferences, null, 'nada foi gravado');

    const gostos = await c.put('/api/me/preferences', { cuisines: ['pizza', 'xyz'], prices: ['$$', '$$$$$'] });
    assert.equal(gostos.status, 200);
    assert.deepEqual(gostos.json.preferences.cuisines, ['pizza']);
    assert.deepEqual(gostos.json.preferences.prices, ['$$']);
    assert.equal(gostos.json.preferences.consentAt, null);

    const ok = await c.put('/api/me/preferences', { ...VEG_SEM_GLUTEN, allergies: ['gluten', 'nada'] });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json.preferences.allergies, ['gluten']);
    assert.ok(ok.json.preferences.consentAt, 'data da autorização registrada');
  });

  test('LGPD: preferências aparecem na exportação, não aparecem para o administrador e podem ser apagadas', async () => {
    const c = await registerUser(srv.base, { name: 'Cliente Alérgica' });
    await c.put('/api/me/preferences', { ...VEG_SEM_GLUTEN, allergies: ['peanut'] });
    const exp = await c.get('/api/me/export');
    assert.deepEqual(exp.json.preferenciasAlimentares.allergies, ['peanut']);

    const admin = client(srv.base);
    await admin.post('/api/auth/login', { email: 'admin@teste.local', password: 'admin-senha-123' });
    const users = await admin.get(`/api/admin/users?q=${encodeURIComponent(c.email)}`);
    assert.ok(!/peanut|amendoim|allerg|prefer/i.test(users.text));

    assert.equal((await c.del('/api/me/preferences')).status, 200);
    assert.equal((await c.get('/api/me/preferences')).json.preferences, null);
  });

  test('Restaurante marca as opções alimentares; valores inválidos são ignorados e o perfil mostra as opções', async () => {
    assert.deepEqual(sushi.diets, ['vegetarian', 'gluten_free']);
    const pub = (await client(srv.base).get(`/api/restaurants/ff-${sushi.id}`)).json.restaurant;
    assert.deepEqual(pub.offers, ['vegetarian', 'gluten_free']);
    assert.equal(pub.match, undefined, 'sem login não há cálculo de compatibilidade');
    const upd = await owner.put(`/api/my/restaurants/${pizza.id}`, { ...pizza, priceRange: '$$', deliveryUrl: '', menuUrl: '', diets: ['gluten_free'] });
    assert.equal(upd.status, 200);
    assert.deepEqual(upd.json.restaurant.diets, ['gluten_free']);
    await owner.put(`/api/my/restaurants/${pizza.id}`, { ...pizza, priceRange: '$$', deliveryUrl: '', menuUrl: '', diets: [] });
  });

  test('Busca "Para você": compatíveis primeiro, com o motivo; o que não combina vem depois ou é escondido', async () => {
    const c = await registerUser(srv.base);
    await c.put('/api/me/preferences', VEG_SEM_GLUTEN);

    const r = await c.get(`/api/restaurants?${AREA}`);
    assert.equal(r.json.personalized, true);
    assert.equal(r.json.filters.sort, 'match', 'com preferências, a ordem padrão é "Para você"');
    const list = r.json.restaurants;
    assert.equal(list[0].name, 'Sushi Verde', 'atende vegetariano e sem glúten e é japonesa: vem primeiro');
    assert.equal(list[0].match.status, 'ok');
    assert.deepEqual(list[0].match.ok, ['Vegetariano', 'Sem glúten']);
    assert.ok(list[0].match.likes.includes('Japonesa e sushi'));

    const byId = id => list.find(x => x.id === id);
    assert.equal(byId(`ff-${pizza.id}`).match.status, 'risk', 'pizzaria sem opção sem glúten: atenção');
    assert.equal(byId('node-1001').match.status, 'conflict', 'o OSM diz diet:vegetarian=no');
    const pos = id => list.findIndex(x => x.id === id);
    assert.ok(pos(`ff-${pizza.id}`) > pos('node-1003') && pos('node-1001') > pos(`ff-${pizza.id}`), 'sem informação antes de atenção, e atenção antes de não atende');

    const fit = await c.get(`/api/restaurants?${AREA}&sort=match&fit=1`);
    const ids = fit.json.restaurants.map(x => x.id);
    assert.ok(!ids.includes('node-1001') && !ids.includes(`ff-${pizza.id}`));
    assert.ok(ids.includes(`ff-${sushi.id}`) && ids.includes('node-1003'), 'sem informação continua aparecendo');
    assert.ok(fit.json.hidden >= 2);

    const dist = await c.get(`/api/restaurants?${AREA}&sort=distance`);
    assert.equal(dist.json.filters.sort, 'distance');
    assert.ok(dist.json.restaurants[0].match, 'os selos continuam com outra ordenação');

    const detail = await c.get('/api/restaurants/node-1001');
    assert.equal(detail.json.restaurant.match.status, 'conflict');
  });

  test('Sem login ou sem preferências: busca normal por distância, sem selos', async () => {
    for (const c of [client(srv.base), await registerUser(srv.base)]) {
      const r = await c.get(`/api/restaurants?${AREA}&sort=match&fit=1`);
      assert.equal(r.json.personalized, false);
      assert.equal(r.json.filters.sort, 'distance');
      assert.ok(r.json.restaurants.every(x => x.match === undefined));
      assert.ok(r.json.restaurants.some(x => x.id === 'node-1001'), 'nada é escondido');
    }
  });

  test('Migração 5 → 6: banco antigo ganha as opções alimentares sem perder restaurantes', async () => {
    const s = await startServer();
    const dono = await registerUser(s.base, { role: 'restaurante' });
    const rest = await createRestaurant(dono, { name: 'Cantina Versão 5' });
    await s.stop();
    const file = path.join(s.dir, 'foodfind.db');
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(file));
    db.run('DROP TABLE user_preferences; ALTER TABLE restaurants DROP COLUMN diets; PRAGMA user_version = 5;');
    fs.writeFileSync(file, Buffer.from(db.export()));

    const s2 = await startServer({ dataDir: s.dir });
    try {
      const again = new SQL.Database(fs.readFileSync(file));
      assert.equal(again.exec('PRAGMA user_version')[0].values[0][0], 6);
      assert.ok(again.exec("SELECT name FROM sqlite_master WHERE name = 'user_preferences'").length);
      const r = (await client(s2.base).get(`/api/restaurants/ff-${rest.id}`)).json.restaurant;
      assert.equal(r.name, 'Cantina Versão 5');
      assert.deepEqual(r.offers, []);
    } finally { await s2.stop(); }
  });
});
