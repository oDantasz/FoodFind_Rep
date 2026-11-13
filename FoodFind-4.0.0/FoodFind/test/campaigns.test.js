// Campanhas, QR Code, segredo do código, resgate (todos os erros), voucher, histórico e cascata.
const { describe, it: test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, registerUser, createRestaurant, createCampaign, spLocal, HOUR, DAY } = require('./_helpers');

describe('Campanhas, QR Code, resgate e vouchers', () => {
  let srv, owner, rest;
  before(async () => {
    srv = await startServer({ env: { PUBLIC_URL: 'https://foodfind.example.com' } });
    owner = await registerUser(srv.base, { role: 'restaurante' });
    rest = await createRestaurant(owner, { name: 'Cantina das Ofertas' });
  });
  after(async () => { await srv.stop(); });

  const redeem = (c, code) => c.post('/api/campaigns/redeem', { code });

  test('HU3.2 validações: título, descrição do benefício, desconto, período e limite', async () => {
    const base = { restaurantId: rest.id, title: 'Oferta', description: 'Benefício', discountType: 'percent', discountValue: 10, startsAt: spLocal(0), endsAt: spLocal(DAY) };
    const bad = async (patch, code) => {
      const r = await owner.post('/api/my/campaigns', { ...base, ...patch });
      assert.equal(r.status, 400, JSON.stringify(patch));
      if (code) assert.equal(r.json.code, code);
    };
    await bad({ title: '' }, 'invalid_title');
    await bad({ description: '' }, 'invalid_description');
    await bad({ description: '   ' }, 'invalid_description');
    await bad({ discountValue: 0 }, 'invalid_discount');
    await bad({ discountValue: 101 }, 'invalid_discount');
    await bad({ discountType: 'grátis' }, 'invalid_discount');
    await bad({ endsAt: spLocal(-DAY) }, 'invalid_period');
    await bad({ endsAt: base.startsAt }, 'invalid_period');
    await bad({ startsAt: 'ontem' }, 'invalid_period');
    await bad({ maxRedemptions: 0 }, 'invalid_limit');
    await bad({ maxRedemptions: 2.5 }, 'invalid_limit');
    const fixed = await owner.post('/api/my/campaigns', { ...base, discountType: 'fixed', discountValue: 12.5, maxRedemptions: null });
    assert.equal(fixed.status, 201);
    assert.equal(fixed.json.campaign.maxRedemptions, null, 'limite opcional');
    assert.match(fixed.json.campaign.discountLabel, /12,50/);
  });

  test('HU3.2 dono: só o dono cria e gerencia campanhas do próprio restaurante', async () => {
    const cli = await registerUser(srv.base);
    assert.equal((await cli.post('/api/my/campaigns', { restaurantId: rest.id })).status, 403);
    assert.equal((await cli.get('/api/my/campaigns')).status, 403);
    const other = await registerUser(srv.base, { role: 'restaurante' });
    const r = await other.post('/api/my/campaigns', { restaurantId: rest.id, title: 'X', description: 'Y', discountType: 'percent', discountValue: 5, startsAt: spLocal(0), endsAt: spLocal(DAY) });
    assert.equal(r.status, 403);
    const c = await createCampaign(owner, rest.id);
    assert.equal((await other.get(`/api/my/campaigns/${c.id}`)).status, 404);
    assert.equal((await other.put(`/api/my/campaigns/${c.id}`, {})).status, 404);
    assert.equal((await other.del(`/api/my/campaigns/${c.id}`)).status, 404);
    assert.equal((await other.get(`/api/my/campaigns/${c.id}/qr.svg`)).status, 404);
    assert.equal((await client(srv.base).get(`/api/my/campaigns/${c.id}/qr.svg`)).status, 401);
  });

  test('HU3.2 datas em America/Sao_Paulo', async () => {
    const c = await createCampaign(owner, rest.id, { startsAt: '2030-01-10T19:30', endsAt: '2030-01-20T23:59' });
    assert.equal(c.startsAt, '2030-01-10T22:30:00.000Z', '19:30 em São Paulo = 22:30 UTC');
    assert.equal(c.startsAtLocal, '2030-01-10T19:30');
    assert.equal(c.status, 'agendada');
  });

  test('HU3.2 listar, editar, pausar/ativar e estados (agendada, ativa, pausada, encerrada, esgotada)', async () => {
    const ativa = await createCampaign(owner, rest.id, { title: 'Ativa' });
    const agendada = await createCampaign(owner, rest.id, { title: 'Agendada', startsAt: spLocal(2 * DAY), endsAt: spLocal(5 * DAY) });
    const list = (await owner.get('/api/my/campaigns')).json.campaigns;
    assert.equal(list.find(x => x.id === ativa.id).status, 'ativa');
    assert.equal(list.find(x => x.id === agendada.id).status, 'agendada');
    const paused = await owner.post(`/api/my/campaigns/${ativa.id}/status`, { active: false });
    assert.equal(paused.json.campaign.status, 'pausada');
    assert.equal((await owner.post(`/api/my/campaigns/${ativa.id}/status`, { active: 'sim' })).status, 400);
    const resumed = await owner.post(`/api/my/campaigns/${ativa.id}/status`, { active: true });
    assert.equal(resumed.json.campaign.status, 'ativa');
    const edited = await owner.put(`/api/my/campaigns/${ativa.id}`, { title: 'Ativa editada', description: 'Novo benefício', discountType: 'fixed', discountValue: 5, startsAt: spLocal(-2 * DAY), endsAt: spLocal(-HOUR), maxRedemptions: 3 });
    assert.equal(edited.status, 200);
    assert.equal(edited.json.campaign.title, 'Ativa editada');
    assert.equal(edited.json.campaign.status, 'encerrada');
    assert.equal(edited.json.campaign.code, ativa.code, 'editar não troca o código (o cartaz impresso continua valendo)');
    const one = await createCampaign(owner, rest.id, { title: 'Uma vaga', maxRedemptions: 1 });
    await redeem(await registerUser(srv.base), one.code);
    assert.equal((await owner.get(`/api/my/campaigns/${one.id}`)).json.campaign.status, 'esgotada');
    assert.equal((await owner.get(`/api/my/campaigns/${one.id}`)).json.campaign.redemptionCount, 1);
    const lower = await owner.put(`/api/my/campaigns/${one.id}`, { title: 'x', description: 'y', discountType: 'percent', discountValue: 5, startsAt: spLocal(-HOUR), endsAt: spLocal(DAY), maxRedemptions: 1 });
    assert.equal(lower.status, 200);
  });

  test('HU3.3 QR Code: SVG gerado no servidor com {PUBLIC_URL}/?resgatar=CODIGO, só para o dono', async () => {
    const c = await createCampaign(owner, rest.id);
    assert.match(c.code, /^[A-HJ-NP-Z2-9]{16}$/, 'código de 16 caracteres sem letras ambíguas');
    assert.equal(c.redeemUrl, `https://foodfind.example.com/?resgatar=${c.code}`);
    const qr = await owner.get(`/api/my/campaigns/${c.id}/qr.svg`);
    assert.equal(qr.status, 200);
    assert.match(qr.headers.get('content-type'), /^image\/svg\+xml/);
    assert.match(qr.text, /^<svg[^>]+viewBox/);
    assert.match(qr.headers.get('cache-control'), /no-store/);
    const dl = await owner.get(`/api/my/campaigns/${c.id}/qr.svg?download=1`);
    assert.match(dl.headers.get('content-disposition'), /attachment; filename="foodfind-campanha-\d+-qrcode\.svg"/);
    // Gerar novo código invalida o antigo.
    const renewed = await owner.post(`/api/my/campaigns/${c.id}/new-code`);
    assert.notEqual(renewed.json.campaign.code, c.code);
    assert.equal((await redeem(await registerUser(srv.base), c.code)).json.code, 'invalid_code');
  });

  test('Segredo: o código da campanha nunca aparece em rotas ou telas públicas', async () => {
    const c = await createCampaign(owner, rest.id, { title: 'Campanha Secreta' });
    const variants = [c.code, c.code.toLowerCase(), c.codeFormatted];
    const visitor = client(srv.base);
    const cli = await registerUser(srv.base);
    await cli.post(`/api/restaurants/ff-${rest.id}/reviews`, { rating: 5 });
    const publicRoutes = [
      '/', '/index.html', '/app.js', `/restaurante/ff-${rest.id}`,
      `/api/restaurants?lat=-23.5613&lng=-46.6565`, `/api/restaurants?lat=-23.5613&lng=-46.6565&q=cantina`,
      `/api/restaurants/ff-${rest.id}`, `/api/restaurants/ff-${rest.id}/campaigns`, `/api/restaurants/ff-${rest.id}/reviews`,
      '/api/auth/me', '/api/health'
    ];
    for (const who of [visitor, cli]) {
      for (const url of publicRoutes) {
        const r = await who.get(url);
        assert.ok(r.status < 500, url);
        for (const v of variants) assert.ok(!r.text.includes(v), `código vazou em ${url}`);
      }
    }
    const pub = (await visitor.get(`/api/restaurants/ff-${rest.id}/campaigns`)).json.campaigns.find(x => x.title === 'Campanha Secreta');
    assert.deepEqual(Object.keys(pub).sort(), ['benefit', 'discountLabel', 'discountType', 'discountValue', 'endsAt', 'hasSlots', 'id', 'startsAt', 'title', 'validUntil'].sort());
    assert.equal(pub.hasSlots, true);
    // Histórico e exportação do cliente também não trazem o código.
    await redeem(cli, c.code);
    for (const url of ['/api/me/redemptions', '/api/me/export']) {
      const r = await cli.get(url);
      for (const v of variants) assert.ok(!r.text.includes(v), `código vazou em ${url}`);
    }
  });

  test('Vitrine "Descontos por perto": só vigentes com vagas, ordenadas por distância e sem o código', async () => {
    const perto = await createRestaurant(owner, { name: 'Vitrine Perto', lat: -23.5614, lng: -46.6566 });
    const longe = await createRestaurant(owner, { name: 'Vitrine Longe', lat: -23.4000, lng: -46.4000 });
    const c1 = await createCampaign(owner, perto.id, { title: 'Perto e vigente' });
    await createCampaign(owner, longe.id, { title: 'Longe demais' });
    const pausada = await createCampaign(owner, perto.id, { title: 'Pausada na vitrine' });
    await owner.post(`/api/my/campaigns/${pausada.id}/status`, { active: false });
    const r = await client(srv.base).get('/api/campaigns/nearby?lat=-23.5613&lng=-46.6565');
    assert.equal(r.status, 200);
    const titles = r.json.campaigns.map(c => c.title);
    assert.ok(titles.includes('Perto e vigente'));
    assert.ok(!titles.includes('Longe demais'));
    assert.ok(!titles.includes('Pausada na vitrine'));
    const item = r.json.campaigns.find(c => c.title === 'Perto e vigente');
    assert.equal(item.restaurantName, 'Vitrine Perto');
    assert.equal(item.code, undefined);
    for (const v of [c1.code, c1.code.toLowerCase(), c1.codeFormatted]) assert.ok(!r.text.includes(v), 'código não aparece na vitrine');
    const d = r.json.campaigns.map(c => c.distanceKm);
    assert.deepEqual(d, [...d].sort((a, b) => a - b));
  });

  test('Lista pública: só campanhas vigentes e não pausadas; indica se há vagas', async () => {
    const r2 = await createRestaurant(owner, { name: 'Vitrine de Campanhas' });
    await createCampaign(owner, r2.id, { title: 'Vigente' });
    await createCampaign(owner, r2.id, { title: 'Futura', startsAt: spLocal(DAY), endsAt: spLocal(2 * DAY) });
    const pausada = await createCampaign(owner, r2.id, { title: 'Pausada' });
    await owner.post(`/api/my/campaigns/${pausada.id}/status`, { active: false });
    const lotada = await createCampaign(owner, r2.id, { title: 'Lotada', maxRedemptions: 1 });
    await redeem(await registerUser(srv.base), lotada.code);
    const list = (await client(srv.base).get(`/api/restaurants/ff-${r2.id}/campaigns`)).json.campaigns;
    assert.deepEqual(list.map(c => c.title).sort(), ['Lotada', 'Vigente']);
    assert.equal(list.find(c => c.title === 'Lotada').hasSlots, false);
    assert.equal((await client(srv.base).get('/api/restaurants/node-1001/campaigns')).json.campaigns.length, 0);
  });

  test('HU3.4 resgate: todos os erros com status, code e motivo distintos', async () => {
    const cli = await registerUser(srv.base);
    const c = await createCampaign(owner, rest.id);
    const anon = await redeem(client(srv.base), c.code);
    assert.deepEqual([anon.status, anon.json.code], [401, 'auth_required']);
    const own = await redeem(owner, c.code);
    assert.deepEqual([own.status, own.json.code], [403, 'not_client']);
    const empty = await redeem(cli, '');
    assert.deepEqual([empty.status, empty.json.code], [400, 'missing_code']);
    const invalid = await redeem(cli, 'NAOEXISTE1234567');
    assert.deepEqual([invalid.status, invalid.json.code], [404, 'invalid_code']);
    const future = await createCampaign(owner, rest.id, { startsAt: spLocal(DAY), endsAt: spLocal(2 * DAY) });
    const nf = await redeem(cli, future.code);
    assert.deepEqual([nf.status, nf.json.code], [409, 'campaign_not_started']);
    assert.match(nf.json.message, /ainda não começou.*começa em \d{2}\/\d{2}\/\d{4}/);
    const ended = await createCampaign(owner, rest.id, { startsAt: spLocal(-2 * DAY), endsAt: spLocal(-HOUR) });
    const en = await redeem(cli, ended.code);
    assert.deepEqual([en.status, en.json.code], [410, 'campaign_ended']);
    assert.match(en.json.message, /encerrada em/);
    const paused = await createCampaign(owner, rest.id);
    await owner.post(`/api/my/campaigns/${paused.id}/status`, { active: false });
    const pa = await redeem(cli, paused.code);
    assert.deepEqual([pa.status, pa.json.code], [423, 'campaign_paused']);
    assert.match(pa.json.message, /pausada/);
    const soldOut = await createCampaign(owner, rest.id, { maxRedemptions: 1 });
    assert.equal((await redeem(await registerUser(srv.base), soldOut.code)).status, 201);
    const so = await redeem(cli, soldOut.code);
    assert.deepEqual([so.status, so.json.code], [409, 'campaign_sold_out']);
    assert.match(so.json.message, /limite/);
    assert.equal((await redeem(cli, c.code)).status, 201);
    const dup = await redeem(cli, c.code);
    assert.deepEqual([dup.status, dup.json.code], [409, 'already_redeemed']);
    const messages = new Set([anon, own, empty, invalid, nf, en, pa, so, dup].map(r => r.json.message));
    assert.equal(messages.size, 9, 'cada caso tem a sua mensagem');
  });

  test('HU3.4 resgate: aceita o link do QR, letras minúsculas e hífens; devolve comprovante', async () => {
    const c = await createCampaign(owner, rest.id, { title: 'Comprovante', description: 'Sobremesa grátis' });
    const a = await registerUser(srv.base);
    const r = await redeem(a, `https://foodfind.example.com/?resgatar=${c.code}`);
    assert.equal(r.status, 201);
    assert.equal(r.json.restaurantName, 'Cantina das Ofertas');
    assert.match(r.json.voucher.voucher, /^FF-\d{6}$/);
    assert.match(r.json.voucher.checkCode, /^[A-Z2-9]{4}$/);
    assert.equal(r.json.voucher.status, 'emitido');
    assert.equal(r.json.voucher.benefit, 'Sobremesa grátis');
    assert.equal(r.json.voucher.validUntil, c.endsAt);
    const b = await registerUser(srv.base);
    assert.equal((await redeem(b, c.codeFormatted.toLowerCase())).status, 201);
  });

  test('Resgate: muitos códigos inválidos bloqueiam temporariamente (anti força bruta)', async () => {
    const cli = await registerUser(srv.base);
    let last;
    for (let i = 0; i < 10; i++) last = await redeem(cli, `ERRADO${i}AAAAAAAAAA`);
    assert.equal(last.status, 404);
    const blocked = await redeem(cli, 'ERRADO99AAAAAAAAA');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.json.code, 'too_many_attempts');
  });

  test('Voucher: dono valida pelo número + código de conferência, uma única vez', async () => {
    const c = await createCampaign(owner, rest.id, { title: 'Voucher único' });
    const cli = await registerUser(srv.base, { name: 'Carla Cliente Souza' });
    const { voucher } = (await redeem(cli, c.code)).json;
    const look = await owner.get(`/api/my/vouchers/${voucher.voucher}`);
    assert.equal(look.status, 200);
    assert.equal(look.json.voucher.client, 'Carla S.');
    assert.equal(look.json.voucher.checkCode, undefined, 'o dono não recebe o código de conferência');
    assert.equal((await owner.get(`/api/my/vouchers/${voucher.voucher.replace('-', '').toLowerCase()}`)).status, 200);
    // Outro dono não vê; código errado não valida.
    const other = await registerUser(srv.base, { role: 'restaurante' });
    assert.equal((await other.get(`/api/my/vouchers/${voucher.voucher}`)).status, 404);
    assert.equal((await cli.get(`/api/my/vouchers/${voucher.voucher}`)).status, 403);
    const wrong = await owner.post(`/api/my/vouchers/${voucher.voucher}/use`, { checkCode: 'ZZZZ' });
    assert.deepEqual([wrong.status, wrong.json.code], [400, 'voucher_check_mismatch']);
    const used = await owner.post(`/api/my/vouchers/${voucher.voucher}/use`, { checkCode: voucher.checkCode.toLowerCase() });
    assert.equal(used.status, 200);
    assert.equal(used.json.voucher.status, 'usado');
    const again = await owner.post(`/api/my/vouchers/${voucher.voucher}/use`, { checkCode: voucher.checkCode });
    assert.deepEqual([again.status, again.json.code], [409, 'voucher_used']);
    const vlist = (await owner.get(`/api/my/campaigns/${c.id}/vouchers`)).json.vouchers;
    assert.equal(vlist[0].status, 'usado');
    assert.equal((await owner.get('/api/my/campaigns')).json.campaigns.find(x => x.id === c.id).vouchersUsed, 1);
    assert.equal((await owner.get('/api/my/vouchers/FF-999999')).status, 404);
  });

  test('Voucher expirado não é validado', async () => {
    const c = await createCampaign(owner, rest.id);
    const cli = await registerUser(srv.base);
    const { voucher } = (await redeem(cli, c.code)).json;
    await owner.put(`/api/my/campaigns/${c.id}`, { title: c.title, description: c.description, discountType: 'percent', discountValue: 15, startsAt: spLocal(-2 * DAY), endsAt: spLocal(-HOUR) });
    const r = await owner.post(`/api/my/vouchers/${voucher.voucher}/use`, { checkCode: voucher.checkCode });
    assert.deepEqual([r.status, r.json.code], [410, 'voucher_expired']);
  });

  test('Histórico "Meus benefícios": lista os vouchers do cliente com status', async () => {
    const cli = await registerUser(srv.base);
    assert.equal((await owner.get('/api/me/redemptions')).status, 403);
    assert.equal((await client(srv.base).get('/api/me/redemptions')).status, 401);
    assert.deepEqual((await cli.get('/api/me/redemptions')).json.redemptions, []);
    const c1 = await createCampaign(owner, rest.id, { title: 'Primeira' });
    const c2 = await createCampaign(owner, rest.id, { title: 'Segunda' });
    const v1 = (await redeem(cli, c1.code)).json.voucher;
    await redeem(cli, c2.code);
    await owner.post(`/api/my/vouchers/${v1.voucher}/use`, { checkCode: v1.checkCode });
    const hist = (await cli.get('/api/me/redemptions')).json.redemptions;
    assert.equal(hist.length, 2);
    assert.deepEqual(hist.map(h => h.campaignTitle).sort(), ['Primeira', 'Segunda']);
    assert.equal(hist.find(h => h.campaignTitle === 'Primeira').status, 'usado');
    assert.equal(hist.find(h => h.campaignTitle === 'Segunda').status, 'emitido');
    assert.ok(hist.every(h => h.restaurantName === 'Cantina das Ofertas' && h.checkCode));
  });

  test('Exclusão em cascata: excluir campanha apaga os resgates; excluir restaurante apaga campanhas', async () => {
    const r2 = await createRestaurant(owner, { name: 'Cascata' });
    const c = await createCampaign(owner, r2.id);
    const cli = await registerUser(srv.base);
    await redeem(cli, c.code);
    const del = await owner.del(`/api/my/campaigns/${c.id}`);
    assert.equal(del.json.redemptionsRemoved, 1);
    assert.equal((await cli.get('/api/me/redemptions')).json.redemptions.length, 0);
    const c2 = await createCampaign(owner, r2.id);
    await redeem(cli, c2.code);
    await owner.del(`/api/my/restaurants/${r2.id}`);
    assert.equal((await owner.get(`/api/my/campaigns/${c2.id}`)).status, 404);
    assert.equal((await cli.get('/api/me/redemptions')).json.redemptions.length, 0);
    assert.equal((await redeem(await registerUser(srv.base), c2.code)).json.code, 'invalid_code');
  });
});
