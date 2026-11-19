// Administração: lista de usuários, resumo (estatísticas) e contagem de visitas (servidor real).
const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, registerUser } = require('./_helpers');

describe('Administração: usuários e resumo', () => {
  let srv, admin;
  before(async () => {
    srv = await startServer({ env: { FOODFIND_VISIT_MAX_PER_HOUR: '3' } });
    admin = client(srv.base);
    const r = await admin.post('/api/auth/login', { email: 'admin@teste.local', password: 'admin-senha-123' });
    assert.equal(r.status, 200);
  });
  after(async () => { await srv.stop(); });

  test('Só o administrador vê usuários e resumo (visitante 401, outras contas 403)', async () => {
    const visitor = client(srv.base);
    assert.equal((await visitor.get('/api/admin/users')).status, 401);
    assert.equal((await visitor.get('/api/admin/stats')).status, 401);
    const c = await registerUser(srv.base);
    assert.equal((await c.get('/api/admin/users')).status, 403);
    const o = await registerUser(srv.base, { role: 'restaurante' });
    assert.equal((await o.get('/api/admin/stats')).status, 403);
  });

  test('Lista de usuários: nome, e-mail, tipo, cadastro e último acesso, sem senha; busca, filtro e páginas', async () => {
    const a = await registerUser(srv.base, { name: 'Joana Busca Teste' });
    await registerUser(srv.base, { role: 'restaurante', name: 'Dono Busca Teste' });
    const r = await admin.get('/api/admin/users');
    assert.equal(r.status, 200);
    const row = r.json.users.find(u => u.email === a.email);
    assert.ok(row, 'o usuário recém-criado aparece');
    assert.equal(row.name, 'Joana Busca Teste');
    assert.equal(row.role, 'cliente');
    assert.ok(row.createdAt && row.lastSeenAt, 'cadastro e último acesso preenchidos');
    assert.ok(!('password_hash' in row) && !JSON.stringify(r.json).includes('scrypt') && !JSON.stringify(r.json).includes('password'));
    assert.equal(r.json.users.find(u => u.email === 'admin@teste.local').isAdmin, true);

    const q = await admin.get('/api/admin/users?q=busca%20teste');
    assert.deepEqual(q.json.users.map(u => u.name).sort(), ['Dono Busca Teste', 'Joana Busca Teste']);
    const byMail = await admin.get(`/api/admin/users?q=${encodeURIComponent(a.email.toUpperCase())}`);
    assert.equal(byMail.json.total, 1);
    const owners = await admin.get('/api/admin/users?role=restaurante');
    assert.ok(owners.json.users.length >= 1 && owners.json.users.every(u => u.role === 'restaurante'));

    for (let i = 0; i < 6; i++) await registerUser(srv.base);
    const p1 = await admin.get('/api/admin/users?limit=5&page=1');
    const p2 = await admin.get('/api/admin/users?limit=5&page=2');
    assert.equal(p1.json.users.length, 5);
    assert.ok(p1.json.pages >= 2 && p2.json.page === 2);
    assert.equal(p1.json.users.filter(u => p2.json.users.some(x => x.id === u.id)).length, 0, 'páginas não se repetem');
  });

  test('Último acesso é gravado no login e aparece na exportação de dados (LGPD)', async () => {
    const u = await registerUser(srv.base);
    const fresh = client(srv.base);
    const before = Date.now();
    await fresh.post('/api/auth/login', { email: u.email, password: u.password });
    const row = (await admin.get(`/api/admin/users?q=${encodeURIComponent(u.email)}`)).json.users[0];
    assert.ok(Date.parse(row.lastSeenAt) >= before - 1000);
    const exp = await fresh.get('/api/me/export');
    assert.equal(exp.json.conta.ultimoAcesso, row.lastSeenAt);
  });

  test('Visitas: só o total do dia, com limite por IP e sem aceitar outra origem', async () => {
    const before = (await admin.get('/api/admin/stats')).json;
    const v = client(srv.base);
    for (let i = 0; i < 5; i++) assert.equal((await v.post('/api/visit', {})).status, 204);
    const after = (await admin.get('/api/admin/stats')).json;
    assert.equal(after.totals.visits - before.totals.visits, 3, 'limite de 3 por IP nesta configuração');
    assert.equal(after.days.length, 14);
    assert.equal(after.days[13].visits - before.days[13].visits, 3, 'hoje é o último dia da série');
    const foreign = await v.post('/api/visit', {}, { origin: 'https://site-malicioso.example' });
    assert.equal(foreign.status, 403);
  });

  test('Resumo: totais de contas, cadastros por dia e aviso de persistência', async () => {
    const s = (await admin.get('/api/admin/stats')).json;
    assert.ok(s.totals.users >= s.totals.clients + s.totals.owners - 1);
    assert.ok(s.totals.activeLast7Days >= 1);
    assert.ok(s.days[13].signups >= 1, 'cadastros de hoje aparecem');
    assert.equal(typeof s.totals.campaignsActive, 'number');
    assert.equal(s.persistent, false, 'sem DATABASE_URL os dados ficam só no disco');
  });
});
