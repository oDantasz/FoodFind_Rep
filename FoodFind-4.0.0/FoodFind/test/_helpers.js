// Utilitários dos testes: sobem o servidor REAL (node server.js) com banco temporário
// e porta livre, um OpenStreetMap simulado (Overpass + Nominatim) e um cliente HTTP com cookies.
// Nenhum teste depende da internet.
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Lugares falsos perto da Av. Paulista.
const OSM_ELEMENTS = [
  { type: 'node', id: 1001, lat: -23.5610, lon: -46.6560, tags: { amenity: 'restaurant', name: 'Restaurante Mapa Aberto', cuisine: 'brazilian', opening_hours: '24/7', website: 'https://mapa-aberto.example.com', phone: '+55 11 3000-0001', 'addr:street': 'Avenida Paulista', 'addr:housenumber': '1000' } },
  { type: 'node', id: 1002, lat: -23.5620, lon: -46.6570, tags: { amenity: 'bar', name: 'Bar Link Perigoso', website: 'javascript:alert(document.cookie)', 'contact:phone': 'javascript:alert(1)', opening_hours: 'Mo-Su off' } },
  { type: 'way', id: 2001, center: { lat: -23.5600, lon: -46.6550 }, tags: { shop: 'bakery', name: 'Padaria do Mapa', website: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==' } },
  { type: 'node', id: 1003, lat: -23.5630, lon: -46.6540, tags: { amenity: 'ice_cream', name: 'Sorvetes OSM' } },
  { type: 'node', id: 1004, lat: -23.5635, lon: -46.6575, tags: { amenity: 'restaurant', name: 'Pizzaria do Mapa', cuisine: 'pizza' } },
  { type: 'node', id: 1005, lat: -23.4000, lon: -46.4000, tags: { amenity: 'restaurant', name: 'Muito Longe' } }
];

function startMockOsm() {
  const state = { fail: false, remark: false, overpassCalls: 0, geocodeCalls: 0 };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (state.fail) { res.writeHead(503); return res.end('indisponível'); }
    if (u.pathname === '/interpreter') {
      state.overpassCalls++;
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        if (state.remark) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ elements: [], remark: 'runtime error: Query timed out in "query" at line 3 after 21 seconds.' }));
        }
        const q = req.headers['content-type'].startsWith('text/plain') ? body : decodeURIComponent(body.replace(/^data=/, '').replace(/\+/g, ' '));
        const byId = /^\s*(node|way|relation)\((\d+)\);/m.exec(q.split('\n').slice(1).join('\n'));
        const elements = byId ? OSM_ELEMENTS.filter(e => e.type === byId[1] && String(e.id) === byId[2]) : OSM_ELEMENTS;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ elements }));
      });
      return;
    }
    if (u.pathname === '/search') {
      state.geocodeCalls++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify([{ display_name: 'Vila Mariana, São Paulo, SP', lat: '-23.5891', lon: '-46.6347' }]));
    }
    res.writeHead(404); res.end();
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    resolve({ state, overpassUrl: `${base}/interpreter`, nominatimUrl: `${base}/search`, close: () => new Promise(r => server.close(r)) });
  }));
}

// Sobe o servidor real em uma porta livre com uma pasta de dados temporária.
async function startServer({ env = {}, dataDir, osm = true } = {}) {
  const dir = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'foodfind-test-'));
  const mock = osm ? await startMockOsm() : null;
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      PORT: '0',
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      FOODFIND_DATA_DIR: dir,
      FOODFIND_OVERPASS_URL: mock ? mock.overpassUrl : 'http://127.0.0.1:9/indisponivel',
      FOODFIND_NOMINATIM_URL: mock ? mock.nominatimUrl : 'http://127.0.0.1:9/indisponivel',
      ADMIN_EMAIL: 'admin@teste.local',
      ADMIN_PASSWORD: 'admin-senha-123',
      FOODFIND_LOGIN_MAX_PER_IP: '100000',
      FOODFIND_REGISTER_MAX_PER_IP: '100000',
      FOODFIND_SEARCH_MAX_PER_MIN: '100000',
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stderr.on('data', d => { logs += d; });
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`servidor não subiu: ${logs}`)), 15000);
    child.stdout.on('data', d => {
      logs += d;
      const m = /http:\/\/localhost:(\d+)/.exec(logs);
      if (m) { clearTimeout(timer); resolve(`http://127.0.0.1:${m[1]}`); }
    });
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`servidor saiu com código ${code}: ${logs}`)); });
  });
  return {
    base, dir, mock, child,
    logs: () => logs,
    async stop() {
      if (child.exitCode === null) {
        child.kill();
        await new Promise(r => child.once('exit', r));
      }
      if (mock) await mock.close();
    }
  };
}

// Cliente HTTP com cookie de sessão (como um navegador).
function client(base) {
  let cookie = '';
  async function request(method, url, body, headers = {}) {
    const opts = { method, headers: { ...headers }, redirect: 'manual' };
    if (cookie) opts.headers.cookie = cookie;
    if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['content-type'] = 'application/json'; }
    const res = await fetch(base + url, opts);
    const set = res.headers.get('set-cookie');
    if (set) {
      const m = /ff_session=([^;]*)/.exec(set);
      cookie = m && m[1] ? `ff_session=${m[1]}` : '';
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, headers: res.headers, text, json, setCookie: set };
  }
  return {
    get: (u, h) => request('GET', u, undefined, h),
    post: (u, b, h) => request('POST', u, b ?? {}, h),
    put: (u, b, h) => request('PUT', u, b ?? {}, h),
    del: (u, b, h) => request('DELETE', u, b, h),
    get cookie() { return cookie; },
    set cookie(v) { cookie = v; }
  };
}

let counter = 0;
function uniqueEmail(prefix = 'user') {
  counter += 1;
  return `${prefix}.${process.pid}.${Date.now()}.${counter}@teste.local`;
}

async function registerUser(base, { role = 'cliente', name = 'Pedro Augusto Dantas Aranda', email = uniqueEmail(role), password = 'senha-forte-123' } = {}) {
  const c = client(base);
  const r = await c.post('/api/auth/register', { name, email, password, role, acceptTerms: true });
  if (r.status !== 201) throw new Error(`cadastro falhou: ${r.status} ${r.text}`);
  c.user = r.json.user;
  c.email = email;
  c.password = password;
  return c;
}

function restaurantBody(extra = {}) {
  return {
    name: 'Cantina de Teste', category: 'Restaurante', cuisine: 'italiana', description: 'Massas frescas', priceRange: '$$',
    website: 'https://cantina.example.com', phone: '(11) 3333-4444', address: 'Av. Paulista, 1000',
    lat: -23.5615, lng: -46.6562,
    hours: Object.fromEntries(['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'].map(d => [d, { closed: false, open: '00:00', close: '23:59' }])),
    menu: [{ section: 'Massas', name: 'Talharim', price: '42,90' }],
    photos: [],
    ...extra
  };
}

async function createRestaurant(owner, extra) {
  const r = await owner.post('/api/my/restaurants', restaurantBody(extra));
  if (r.status !== 201) throw new Error(`restaurante falhou: ${r.status} ${r.text}`);
  return r.json.restaurant;
}

// Datas no formato do <input type="datetime-local"> (horário de São Paulo).
function spLocal(offsetMs) {
  const d = new Date(Date.now() + offsetMs);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

async function createCampaign(owner, restaurantId, extra = {}) {
  const r = await owner.post('/api/my/campaigns', {
    restaurantId, title: '15% no almoço', description: 'Válido de segunda a sexta', discountType: 'percent', discountValue: 15,
    startsAt: spLocal(-HOUR), endsAt: spLocal(10 * DAY), maxRedemptions: 50, ...extra
  });
  if (r.status !== 201) throw new Error(`campanha falhou: ${r.status} ${r.text}`);
  return r.json.campaign;
}

module.exports = { ROOT, OSM_ELEMENTS, startServer, startMockOsm, client, uniqueEmail, registerUser, restaurantBody, createRestaurant, createCampaign, spLocal, HOUR, DAY };
