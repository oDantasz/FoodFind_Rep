// Cadastro, login, sessão, logout e limite de tentativas (servidor real).
const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const initSqlJs = require('sql.js');
const { startServer, client, uniqueEmail, registerUser } = require('./_helpers');

describe('Autenticação e sessão', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(async () => { await srv.stop(); });

  test('HU1.1 cadastro: cria conta Cliente e já inicia a sessão', async () => {
    const c = client(srv.base);
    const email = uniqueEmail('novo');
    const r = await c.post('/api/auth/register', { name: 'Pedro Augusto', email, password: 'senha-forte-123', role: 'cliente', acceptTerms: true });
    assert.equal(r.status, 201);
    assert.equal(r.json.user.role, 'cliente');
    assert.equal(r.json.user.email, email);
    assert.equal(r.json.user.password_hash, undefined, 'nunca devolve o hash da senha');
    const me = await c.get('/api/auth/me');
    assert.equal(me.json.user.email, email);
  });

  test('HU1.1 cadastro: valida campos, senha mínima de 8, termos e e-mail duplicado', async () => {
    const c = client(srv.base);
    const email = uniqueEmail('val');
    assert.equal((await c.post('/api/auth/register', { name: '', email, password: 'senha-forte-123', acceptTerms: true })).status, 400);
    assert.equal((await c.post('/api/auth/register', { name: 'Ana', email: 'invalido', password: 'senha-forte-123', acceptTerms: true })).status, 400);
    const weak = await c.post('/api/auth/register', { name: 'Ana', email, password: '1234567', acceptTerms: true });
    assert.equal(weak.status, 400);
    assert.equal(weak.json.code, 'weak_password');
    const terms = await c.post('/api/auth/register', { name: 'Ana', email, password: 'senha-forte-123' });
    assert.equal(terms.status, 400);
    assert.equal(terms.json.code, 'terms_required');
    assert.equal((await c.post('/api/auth/register', { name: 'Ana', email, password: 'senha-forte-123', acceptTerms: true })).status, 201);
    const dup = await client(srv.base).post('/api/auth/register', { name: 'Ana', email: email.toUpperCase(), password: 'senha-forte-123', acceptTerms: true });
    assert.equal(dup.status, 409);
  });

  test('HU1.1 cadastro: conta Restaurante e e-mail do administrador reservado', async () => {
    const owner = await registerUser(srv.base, { role: 'restaurante' });
    assert.equal(owner.user.role, 'restaurante');
    const r = await client(srv.base).post('/api/auth/register', { name: 'Intruso', email: 'admin@teste.local', password: 'senha-forte-123', acceptTerms: true });
    assert.equal(r.status, 403);
    assert.equal(r.json.code, 'reserved_email');
  });

  test('HU1.2 login: mensagem genérica não revela se o e-mail existe', async () => {
    const u = await registerUser(srv.base);
    const wrong = await client(srv.base).post('/api/auth/login', { email: u.email, password: 'senha-errada-000' });
    const missing = await client(srv.base).post('/api/auth/login', { email: uniqueEmail('naoexiste'), password: 'senha-errada-000' });
    assert.equal(wrong.status, 401);
    assert.equal(missing.status, 401);
    assert.equal(wrong.json.message, missing.json.message);
    assert.equal(wrong.json.code, missing.json.code);
    const ok = await client(srv.base).post('/api/auth/login', { email: u.email.toUpperCase(), password: u.password });
    assert.equal(ok.status, 200);
  });

  test('Sessão: cookie HttpOnly e SameSite; Secure quando atrás de proxy HTTPS', async () => {
    const u = await registerUser(srv.base);
    const r = await client(srv.base).post('/api/auth/login', { email: u.email, password: u.password });
    assert.match(r.setCookie, /HttpOnly/);
    assert.match(r.setCookie, /SameSite=Lax/);
    assert.doesNotMatch(r.setCookie, /Secure/);
    const https = await client(srv.base).post('/api/auth/login', { email: u.email, password: u.password }, { 'x-forwarded-proto': 'https' });
    assert.match(https.setCookie, /; Secure/);
  });

  test('Sessão: o banco guarda só o hash do token, nunca o token', async () => {
    const u = await registerUser(srv.base);
    const token = /ff_session=([^;]+)/.exec(u.cookie)[1];
    const SQL = await initSqlJs();
    const dbFile = new SQL.Database(fs.readFileSync(path.join(srv.dir, 'foodfind.db')));
    const rows = dbFile.exec('SELECT * FROM sessions')[0];
    const cols = rows.columns;
    assert.ok(!cols.includes('token'), 'não existe coluna com o token puro');
    const hashes = rows.values.map(v => v[cols.indexOf('token_hash')]);
    assert.ok(hashes.includes(crypto.createHash('sha256').update(token).digest('hex')));
    assert.ok(!JSON.stringify(rows.values).includes(token), 'token puro não aparece no banco');
    const raw = fs.readFileSync(path.join(srv.dir, 'foodfind.db')).toString('latin1');
    assert.ok(!raw.includes(token));
  });

  test('Sessão: login gira a sessão (a anterior deixa de valer) e logout encerra', async () => {
    const u = await registerUser(srv.base);
    const old = u.cookie;
    const relog = await u.post('/api/auth/login', { email: u.email, password: u.password });
    assert.equal(relog.status, 200);
    assert.notEqual(u.cookie, old);
    const stale = client(srv.base);
    stale.cookie = old;
    assert.equal((await stale.get('/api/auth/me')).json.user, null, 'cookie antigo não vale mais');
    const out = await u.post('/api/auth/logout');
    assert.equal(out.status, 200);
    assert.match(out.setCookie, /Max-Age=0/);
    assert.equal((await u.get('/api/auth/me')).json.user, null);
  });

  test('Limite de tentativas: 5 senhas erradas bloqueiam o e-mail temporariamente', async () => {
    const u = await registerUser(srv.base);
    const c = client(srv.base);
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await c.post('/api/auth/login', { email: u.email, password: 'errada-0000' })).status);
    assert.deepEqual(statuses.slice(0, 4), [401, 401, 401, 401]);
    assert.equal(statuses[4], 429);
    const blocked = await c.post('/api/auth/login', { email: u.email, password: u.password });
    assert.equal(blocked.status, 429, 'nem a senha correta entra durante o bloqueio');
    assert.equal(blocked.json.code, 'too_many_attempts');
    assert.match(blocked.json.message, /aguarde \d+ minutos?/);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    // Outro e-mail continua funcionando.
    const other = await registerUser(srv.base);
    assert.equal((await client(srv.base).post('/api/auth/login', { email: other.email, password: other.password })).status, 200);
  });

  test('Limite de tentativas por IP no login e no cadastro (configuração padrão)', async () => {
    const strict = await startServer({ env: { FOODFIND_LOGIN_MAX_PER_IP: '20', FOODFIND_REGISTER_MAX_PER_IP: '10' }, osm: false });
    try {
      const c = client(strict.base);
      let last;
      for (let i = 0; i < 11; i++) last = await c.post('/api/auth/register', { name: 'Robô', email: uniqueEmail('bot'), password: 'senha-forte-123', acceptTerms: true });
      assert.equal(last.status, 429);
      let lastLogin;
      for (let i = 0; i < 21; i++) lastLogin = await c.post('/api/auth/login', { email: uniqueEmail('x'), password: 'qualquer-coisa' });
      assert.equal(lastLogin.status, 429);
      assert.match(lastLogin.json.message, /Muitas tentativas/);
    } finally { await strict.stop(); }
  });

  test('Logs do servidor não contêm senhas nem tokens', async () => {
    const u = await registerUser(srv.base, { password: 'senha-super-secreta-987' });
    await client(srv.base).post('/api/auth/login', { email: u.email, password: 'senha-super-secreta-987' });
    const token = /ff_session=([^;]+)/.exec(u.cookie)[1];
    assert.ok(!srv.logs().includes('senha-super-secreta-987'));
    assert.ok(!srv.logs().includes(token));
  });
});
