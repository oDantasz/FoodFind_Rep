// Contas e LGPD: editar nome, trocar senha, sair de todos, exportar e excluir conta (servidor real).
const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, client, registerUser, createRestaurant, createCampaign } = require('./_helpers');

describe('Conta e LGPD', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(async () => { await srv.stop(); });

  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

  test('Editar nome', async () => {
    const u = await registerUser(srv.base);
    assert.equal((await client(srv.base).put('/api/me', { name: 'X' })).status, 401);
    assert.equal((await u.put('/api/me', { name: ' ' })).status, 400);
    const r = await u.put('/api/me', { name: 'Nome Novo da Silva' });
    assert.equal(r.status, 200);
    assert.equal(r.json.user.name, 'Nome Novo da Silva');
  });

  test('Trocar senha: exige a atual, mínimo de 8 e encerra as outras sessões', async () => {
    const u = await registerUser(srv.base);
    const other = client(srv.base);
    await other.post('/api/auth/login', { email: u.email, password: u.password });
    assert.equal((await u.post('/api/me/password', { currentPassword: 'errada-123', newPassword: 'nova-senha-123' })).json.code, 'wrong_password');
    assert.equal((await u.post('/api/me/password', { currentPassword: u.password, newPassword: 'curta' })).json.code, 'weak_password');
    const r = await u.post('/api/me/password', { currentPassword: u.password, newPassword: 'nova-senha-123' });
    assert.equal(r.status, 200);
    assert.equal((await u.get('/api/auth/me')).json.user.email, u.email, 'este dispositivo continua conectado (nova sessão)');
    assert.equal((await other.get('/api/auth/me')).json.user, null, 'outro dispositivo foi desconectado');
    assert.equal((await client(srv.base).post('/api/auth/login', { email: u.email, password: 'nova-senha-123' })).status, 200);
  });

  test('Sair de todos os dispositivos', async () => {
    const u = await registerUser(srv.base);
    const other = client(srv.base);
    await other.post('/api/auth/login', { email: u.email, password: u.password });
    const r = await u.post('/api/me/logout-all');
    assert.equal(r.status, 200);
    assert.equal((await u.get('/api/auth/me')).json.user, null);
    assert.equal((await other.get('/api/auth/me')).json.user, null);
  });

  test('Exportar meus dados (JSON, sem senha nem token)', async () => {
    const owner = await registerUser(srv.base, { role: 'restaurante' });
    const rest = await createRestaurant(owner, { name: 'Exportável' });
    const camp = await createCampaign(owner, rest.id);
    const u = await registerUser(srv.base, { name: 'Lia Exporta' });
    await u.post(`/api/restaurants/ff-${rest.id}/reviews`, { rating: 5, comment: 'Ótimo' });
    await u.post('/api/campaigns/redeem', { code: camp.code });
    const r = await u.get('/api/me/export');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition'), /attachment; filename="foodfind-meus-dados-\d{4}-\d{2}-\d{2}\.json"/);
    assert.equal(r.json.conta.email, u.email);
    assert.equal(r.json.avaliacoes[0].comentario, 'Ótimo');
    assert.equal(r.json.beneficios.length, 1);
    assert.ok(!r.text.includes(u.password));
    assert.ok(!r.text.includes('password_hash'));
    assert.ok(!r.text.includes(/ff_session=([^;]+)/.exec(u.cookie)[1]));
    const ownerExport = (await owner.get('/api/me/export')).json;
    assert.equal(ownerExport.restaurantes[0].name, 'Exportável');
    assert.equal(ownerExport.campanhas.length, 1);
    assert.equal((await client(srv.base).get('/api/me/export')).status, 401);
  });

  test('Excluir conta de cliente: confirma com a senha e apaga sessões, avaliações e resgates', async () => {
    const owner = await registerUser(srv.base, { role: 'restaurante' });
    const rest = await createRestaurant(owner);
    const camp = await createCampaign(owner, rest.id, { maxRedemptions: 1 });
    const u = await registerUser(srv.base);
    await u.post(`/api/restaurants/ff-${rest.id}/reviews`, { rating: 1 });
    await u.post('/api/campaigns/redeem', { code: camp.code });
    const cookie = u.cookie;
    assert.equal((await u.del('/api/me', { password: 'errada-000' })).json.code, 'wrong_password');
    const r = await u.del('/api/me', { password: u.password });
    assert.equal(r.status, 200);
    const stale = client(srv.base);
    stale.cookie = cookie;
    assert.equal((await stale.get('/api/auth/me')).json.user, null);
    assert.equal((await client(srv.base).post('/api/auth/login', { email: u.email, password: u.password })).status, 401);
    assert.equal((await client(srv.base).get(`/api/restaurants/ff-${rest.id}/reviews`)).json.count, 0);
    const c = (await owner.get(`/api/my/campaigns/${camp.id}`)).json.campaign;
    assert.equal(c.redemptionCount, 0, 'resgate apagado libera a vaga');
  });

  test('Excluir conta de dono: apaga restaurantes, campanhas, resgates e fotos do disco', async () => {
    const owner = await registerUser(srv.base, { role: 'restaurante' });
    const up = await owner.post('/api/uploads', { dataUrl: `data:image/png;base64,${PNG.toString('base64')}` });
    assert.equal(up.status, 201);
    const file = path.join(srv.dir, 'uploads', up.json.url.replace('/uploads/', ''));
    assert.ok(fs.existsSync(file));
    const rest = await createRestaurant(owner, { photos: [up.json.url] });
    const camp = await createCampaign(owner, rest.id);
    const cli = await registerUser(srv.base);
    await cli.post('/api/campaigns/redeem', { code: camp.code });
    await cli.post(`/api/restaurants/ff-${rest.id}/reviews`, { rating: 5 });
    assert.equal((await owner.del('/api/me', { password: owner.password })).status, 200);
    assert.equal((await client(srv.base).get(`/api/restaurants/ff-${rest.id}`)).status, 404);
    assert.equal((await cli.get('/api/me/redemptions')).json.redemptions.length, 0);
    assert.equal((await cli.get('/api/me/export')).json.avaliacoes.length, 0);
    await new Promise(r => setTimeout(r, 100));
    assert.ok(!fs.existsSync(file), 'foto apagada do disco');
    assert.equal((await client(srv.base).get(up.json.url)).status, 404);
  });

  test('A conta do administrador não pode ser excluída pelo app', async () => {
    const admin = client(srv.base);
    await admin.post('/api/auth/login', { email: 'admin@teste.local', password: 'admin-senha-123' });
    const r = await admin.del('/api/me', { password: 'admin-senha-123' });
    assert.equal(r.status, 403);
  });
});
