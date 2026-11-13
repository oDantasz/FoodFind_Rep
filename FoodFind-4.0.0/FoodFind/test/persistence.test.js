// Persistência externa em PostgreSQL (DATABASE_URL), usada em hospedagens com disco temporário.
// Precisa de um PostgreSQL de teste: FOODFIND_TEST_DATABASE_URL=postgres://... npm test
// Sem essa variável, a suíte é pulada (o CI não tem PostgreSQL).
const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { startServer, client, registerUser, createRestaurant, ROOT } = require('./_helpers');

const URL_ = process.env.FOODFIND_TEST_DATABASE_URL;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'foodfind-pg-'));

describe('Persistência no PostgreSQL (DATABASE_URL)', { skip: !URL_ && 'defina FOODFIND_TEST_DATABASE_URL para rodar' }, () => {
  before(async () => {
    const { Pool } = require('pg');
    const p = new Pool({ connectionString: URL_ });
    await p.query('DROP TABLE IF EXISTS foodfind_snapshot; DROP TABLE IF EXISTS foodfind_files;');
    await p.end();
  });

  test('Banco e fotos sobrevivem a um servidor novo com o disco vazio', async () => {
    const a = await startServer({ env: { DATABASE_URL: URL_ } });
    const owner = await registerUser(a.base, { role: 'restaurante', name: 'Dona Persistente' });
    const up = await owner.post('/api/uploads', { dataUrl: `data:image/png;base64,${PNG.toString('base64')}` });
    assert.equal(up.status, 201);
    const rest = await createRestaurant(owner, { name: 'Cantina Persistente', photos: [up.json.url] });
    await a.stop(); // SIGTERM: espera a cópia chegar ao PostgreSQL

    const b = await startServer({ env: { DATABASE_URL: URL_ } }); // pasta de dados nova e vazia
    try {
      assert.notEqual(b.dir, a.dir);
      const again = client(b.base);
      const login = await again.post('/api/auth/login', { email: owner.email, password: owner.password });
      assert.equal(login.status, 200, 'a conta continua existindo');
      const profile = await client(b.base).get(`/api/restaurants/ff-${rest.id}`);
      assert.equal(profile.status, 200);
      assert.equal(profile.json.restaurant.name, 'Cantina Persistente');
      const photo = await fetch(b.base + up.json.url);
      assert.equal(photo.status, 200, 'a foto foi restaurada do PostgreSQL');
      assert.ok(Buffer.from(await photo.arrayBuffer()).equals(PNG));
      assert.match(b.logs(), /banco restaurado do PostgreSQL/);
      assert.ok(!b.logs().includes(URL_), 'o endereço do banco não vai para o log');
    } finally { await b.stop(); }
  });

  test('Seed grava no PostgreSQL e o servidor seguinte encontra os dados de demonstração', async () => {
    const dir = tmp();
    await new Promise((resolve, reject) => execFile(process.execPath, [path.join(ROOT, 'scripts/seed.js'), '--reset'], {
      env: { PATH: process.env.PATH, FOODFIND_DATA_DIR: dir, DATABASE_URL: URL_, SEED_PASSWORD: 'Senha-Seed-2026' }
    }, (e, out, err) => (e ? reject(new Error(err || e.message)) : resolve(out))));
    const s = await startServer({ env: { DATABASE_URL: URL_ } });
    try {
      const c = client(s.base);
      assert.equal((await c.post('/api/auth/login', { email: 'cliente@foodfind.local', password: 'Senha-Seed-2026' })).status, 200);
    } finally { await s.stop(); }
  });

  test('Um processo antigo deixa de gravar quando outro assume o banco (novo deploy)', async () => {
    const old = await startServer({ env: { DATABASE_URL: URL_ } });
    const neu = await startServer({ env: { DATABASE_URL: URL_ } });
    try {
      const lost = await registerUser(old.base, { name: 'Gravado No Antigo' });
      const kept = await registerUser(neu.base, { name: 'Gravado No Novo' });
      await new Promise(r => setTimeout(r, 800));
      await old.stop();
      await neu.stop();
      const check = await startServer({ env: { DATABASE_URL: URL_ } });
      try {
        const c = client(check.base);
        assert.equal((await c.post('/api/auth/login', { email: kept.email, password: kept.password })).status, 200);
        assert.equal((await client(check.base).post('/api/auth/login', { email: lost.email, password: lost.password })).status, 401,
          'o processo antigo não sobrescreveu o banco do novo');
        assert.match(old.logs(), /outro processo assumiu o banco/);
      } finally { await check.stop(); }
    } finally { await old.stop(); await neu.stop(); }
  });

  test('PostgreSQL fora do ar: o servidor não sobe com banco vazio', async () => {
    await assert.rejects(startServer({ osm: false, env: { DATABASE_URL: 'postgres://ninguem:senha@127.0.0.1:9/nada' } }), /saiu com código 1/);
  });
});
