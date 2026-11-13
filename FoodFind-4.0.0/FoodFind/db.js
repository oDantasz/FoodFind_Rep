// Banco de dados SQLite do FoodFind.
// Usa o sql.js (SQLite compilado para WebAssembly), então não precisa instalar
// nenhum programa extra: o `npm install` já resolve tudo, inclusive no Windows.
// O banco fica no arquivo <pasta de dados>/foodfind.db e pode ser aberto em
// programas como o "DB Browser for SQLite" para consultar os dados.
// A pasta de dados é ./data por padrão ou a definida em FOODFIND_DATA_DIR.
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const remote = require('./lib/remote');

const SCHEMA_VERSION = 5;

let DATA_DIR = '';
let DB_FILE = '';
let UPLOAD_DIR = '';
let db = null;
let inTransaction = false;

// Esquema final (versão 4). Todas as chaves estrangeiras usam exclusão em cascata,
// exceto as avaliações, que pertencem ao lugar (place_ref) e não ao dono.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'cliente' CHECK (role IN ('cliente', 'restaurante')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT,
  last_seen_at  TEXT                          -- último acesso logado (atualizado no máximo a cada 30 min)
);

CREATE TABLE IF NOT EXISTS sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,            -- SHA-256 do token; o token em si só existe no cookie
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS restaurants (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  osm_ref      TEXT UNIQUE,                   -- preenchido quando o restaurante já existia no OpenStreetMap
  name         TEXT NOT NULL,
  category     TEXT,
  cuisine      TEXT,
  description  TEXT,
  website      TEXT,                          -- URL para onde o botão "Visitar site" redireciona
  phone        TEXT,
  whatsapp     TEXT,
  instagram    TEXT,
  delivery_url TEXT,
  menu_url     TEXT,
  price_range  TEXT,
  address      TEXT,
  lat          REAL NOT NULL,
  lng          REAL NOT NULL,
  hours        TEXT,                          -- JSON com o horário de cada dia da semana
  menu         TEXT,                          -- JSON com os itens do cardápio
  photos       TEXT,                          -- JSON com a lista de fotos (a primeira é a capa)
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- place_ref identifica o lugar: "ff-12" para restaurantes criados no FoodFind
-- ou "node-123"/"way-123"/"relation-123" para lugares do OpenStreetMap
-- (inclusive os que foram assumidos por um dono, para que as avaliações antigas continuem valendo).
CREATE TABLE IF NOT EXISTS reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  place_ref  TEXT NOT NULL,
  place_name TEXT NOT NULL DEFAULT '',
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (place_ref, user_id)
);

CREATE TABLE IF NOT EXISTS campaigns (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id   INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  code            TEXT NOT NULL UNIQUE,       -- segredo; só o dono vê (no QR Code)
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  discount_type   TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value  REAL NOT NULL CHECK (discount_value > 0),
  starts_at       TEXT NOT NULL,
  ends_at         TEXT NOT NULL,
  max_redemptions INTEGER,                    -- NULL = sem limite
  active          INTEGER NOT NULL DEFAULT 1, -- 0 = pausada pelo dono
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- Cada resgate gera um voucher FF-000123 com um código de conferência.
CREATE TABLE IF NOT EXISTS redemptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  check_code  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'emitido' CHECK (status IN ('emitido', 'usado')),
  redeemed_at TEXT NOT NULL,
  used_at     TEXT,
  UNIQUE (campaign_id, user_id)
);

-- Pedidos para assumir um restaurante que já existe no OpenStreetMap.
CREATE TABLE IF NOT EXISTS claims (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  osm_ref       TEXT NOT NULL,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovado', 'recusado')),
  data          TEXT NOT NULL,                -- JSON com os dados iniciais do restaurante
  message       TEXT NOT NULL DEFAULT '',
  reason        TEXT NOT NULL DEFAULT '',
  restaurant_id INTEGER REFERENCES restaurants(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  decided_at    TEXT,
  decided_by    INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- Fotos enviadas: permite saber quem é o dono de cada arquivo e apagar órfãs.
CREATE TABLE IF NOT EXISTS uploads (
  file       TEXT PRIMARY KEY,
  owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

-- Visitas por dia, só o número (sem IP, sem cookie, sem identificar o visitante).
CREATE TABLE IF NOT EXISTS visits_daily (
  day    TEXT PRIMARY KEY,                    -- AAAA-MM-DD no horário de São Paulo
  visits INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_restaurants_owner ON restaurants(owner_id);
CREATE INDEX IF NOT EXISTS idx_reviews_place ON reviews(place_ref, updated_at);
CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_restaurant ON campaigns(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_redemptions_campaign ON redemptions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_redemptions_user ON redemptions(user_id);
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_ref ON claims(osm_ref);
CREATE INDEX IF NOT EXISTS idx_uploads_owner ON uploads(owner_id);
`;

function tableExists(name) {
  return Boolean(get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name]));
}

function columns(table) {
  return tableExists(table) ? all(`PRAGMA table_info(${table})`).map(c => c.name) : [];
}

function randomCheckCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = require('crypto').randomBytes(4);
  return [...bytes].map(b => alphabet[b % alphabet.length]).join('');
}

// Converte um banco das versões 2.2/3 (sem user_version) para o esquema 4,
// preservando usuários, restaurantes, avaliações, campanhas e resgates.
// As sessões antigas guardavam o token em texto puro e são descartadas
// (os usuários só precisam entrar de novo).
function migrateLegacy() {
  const legacy = ['users', 'sessions', 'restaurants', 'reviews', 'campaigns', 'redemptions'].filter(tableExists);
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN;');
  try {
    for (const t of legacy) db.exec(`ALTER TABLE ${t} RENAME TO legacy_${t};`);
    db.exec(SCHEMA);
    const now = new Date().toISOString();
    if (legacy.includes('users')) {
      db.exec(`INSERT INTO users (id, name, email, password_hash, role, created_at, updated_at)
        SELECT id, name, lower(email), password_hash, CASE WHEN role = 'restaurante' THEN 'restaurante' ELSE 'cliente' END, created_at, created_at
        FROM legacy_users;`);
    }
    if (legacy.includes('restaurants')) {
      db.exec(`INSERT INTO restaurants SELECT id, owner_id, osm_ref, name, category, cuisine, description, website, phone, whatsapp,
        instagram, delivery_url, menu_url, price_range, address, lat, lng, hours, menu, photos, created_at, updated_at
        FROM legacy_restaurants WHERE owner_id IN (SELECT id FROM users);`);
      // Registra as fotos já existentes como pertencentes ao dono do restaurante.
      for (const r of all('SELECT owner_id, photos FROM restaurants')) {
        let photos = [];
        try { photos = JSON.parse(r.photos || '[]'); } catch { photos = []; }
        for (const p of photos) {
          const m = /^\/uploads\/([a-f0-9-]{36}\.(jpg|png|webp))$/.exec(String(p));
          if (m) db.run('INSERT OR IGNORE INTO uploads (file, owner_id, created_at) VALUES (?, ?, ?)', [m[1], r.owner_id, Date.now()]);
        }
      }
    }
    if (legacy.includes('reviews')) {
      db.exec(`INSERT INTO reviews (id, place_ref, place_name, user_id, rating, comment, created_at, updated_at)
        SELECT rv.id, COALESCE(r.osm_ref, 'ff-' || rv.restaurant_id), r.name, rv.user_id, rv.rating, COALESCE(rv.comment, ''), rv.created_at, rv.updated_at
        FROM legacy_reviews rv JOIN restaurants r ON r.id = rv.restaurant_id
        WHERE rv.user_id IN (SELECT id FROM users);`);
    }
    if (legacy.includes('campaigns')) {
      db.exec(`INSERT INTO campaigns (id, restaurant_id, code, title, description, discount_type, discount_value, starts_at, ends_at, max_redemptions, active, created_at, updated_at)
        SELECT id, restaurant_id, upper(code), title, COALESCE(NULLIF(description, ''), title), discount_type, discount_value, starts_at, ends_at,
               max_redemptions, active, created_at, created_at
        FROM legacy_campaigns WHERE restaurant_id IN (SELECT id FROM restaurants);`);
    }
    if (legacy.includes('redemptions')) {
      const rows = all(`SELECT id, campaign_id, user_id, redeemed_at FROM legacy_redemptions
        WHERE campaign_id IN (SELECT id FROM campaigns) AND user_id IN (SELECT id FROM users)`);
      for (const r of rows) {
        db.run('INSERT INTO redemptions (id, campaign_id, user_id, check_code, status, redeemed_at) VALUES (?, ?, ?, ?, ?, ?)',
          [r.id, r.campaign_id, r.user_id, randomCheckCode(), 'emitido', r.redeemed_at]);
      }
    }
    for (const t of legacy) db.exec(`DROP TABLE legacy_${t};`);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
    db.exec('COMMIT;');
    console.log(`Banco migrado para a versão ${SCHEMA_VERSION} em ${now}.`);
  } catch (e) {
    db.exec('ROLLBACK;');
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

// Versão 4 → 5: último acesso do usuário e contagem de visitas por dia.
function upgradeTo5() {
  if (!columns('users').includes('last_seen_at')) db.exec('ALTER TABLE users ADD COLUMN last_seen_at TEXT;');
  db.exec(SCHEMA);
  db.exec('PRAGMA user_version = 5;');
}

function resolveDataDir(dir) {
  return path.resolve(dir || process.env.FOODFIND_DATA_DIR || path.join(__dirname, 'data'));
}

async function init(dir) {
  DATA_DIR = resolveDataDir(dir);
  DB_FILE = path.join(DATA_DIR, 'foodfind.db');
  UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.accessSync(DATA_DIR, fs.constants.W_OK);
  // Hospedagem com disco temporário: baixa a cópia guardada no PostgreSQL antes de abrir o banco.
  // Se o PostgreSQL não responder, o erro sobe e o processo não inicia com um banco vazio.
  if (remote.enabled()) await remote.restore(DATA_DIR);
  const SQL = await initSqlJs();
  db = fs.existsSync(DB_FILE) ? new SQL.Database(fs.readFileSync(DB_FILE)) : new SQL.Database();
  db.exec('PRAGMA foreign_keys = ON;');
  const version = get('PRAGMA user_version').user_version;
  if (version < 4 && tableExists('users')) migrateLegacy();
  else if (version === 4) upgradeTo5();
  else {
    db.exec(SCHEMA);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  }
  cleanExpiredSessions();
  save();
  return { DATA_DIR, DB_FILE, UPLOAD_DIR };
}

// Grava o banco no disco de forma atômica: escreve um arquivo temporário,
// força a gravação (fsync) e só então substitui o arquivo antigo.
function save() {
  const data = Buffer.from(db.export());
  // db.export() desliga as chaves estrangeiras no sql.js; religa logo depois.
  db.exec('PRAGMA foreign_keys = ON;');
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, DB_FILE);
  } catch (e) {
    // Windows: antivírus pode travar o rename por alguns milissegundos.
    try { fs.copyFileSync(tmp, DB_FILE); fs.unlinkSync(tmp); }
    catch { throw e; }
  }
  remote.queueDb(data);
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

function get(sql, params = []) {
  return all(sql, params)[0] || null;
}

// Executa INSERT/UPDATE/DELETE, salva no disco (fora de transação) e devolve o id inserido.
function run(sql, params = []) {
  db.run(sql, params);
  const lastId = get('SELECT last_insert_rowid() AS id').id;
  if (!inTransaction) save();
  return lastId;
}

function changes() {
  return db.getRowsModified();
}

// Executa várias alterações de uma vez: ou todas são gravadas, ou nenhuma.
function tx(fn) {
  if (inTransaction) return fn();
  db.exec('BEGIN;');
  inTransaction = true;
  try {
    const result = fn();
    db.exec('COMMIT;');
    inTransaction = false;
    save();
    return result;
  } catch (e) {
    inTransaction = false;
    try { db.exec('ROLLBACK;'); } catch { /* transação já encerrada */ }
    throw e;
  }
}

function cleanExpiredSessions() {
  db.run('DELETE FROM sessions WHERE expires_at < ?', [Date.now()]);
  return db.getRowsModified();
}

// Arquivo de trava: indica que um servidor está usando esta pasta de dados.
// Scripts que gravam direto no banco (seed) se recusam a rodar com o servidor no ar,
// porque o servidor mantém o banco em memória e sobrescreveria as alterações.
function lockFile(dir) { return path.join(resolveDataDir(dir || DATA_DIR), 'foodfind.lock'); }

function acquireLock() {
  fs.writeFileSync(lockFile(), JSON.stringify({ pid: process.pid, host: require('os').hostname(), startedAt: new Date().toISOString() }));
}

function releaseLock() {
  try {
    const info = JSON.parse(fs.readFileSync(lockFile(), 'utf8'));
    if (info.pid === process.pid) fs.unlinkSync(lockFile());
  } catch { /* sem trava */ }
}

// Devolve os dados da trava se outro processo (vivo) estiver usando a pasta.
function activeLock(dir) {
  let info;
  try { info = JSON.parse(fs.readFileSync(lockFile(dir), 'utf8')); } catch { return null; }
  if (info.host === require('os').hostname()) {
    try { process.kill(info.pid, 0); } catch (e) { if (e.code === 'ESRCH') return null; }
  }
  return info;
}

module.exports = {
  init, all, get, run, tx, changes, save,
  flushRemote: () => remote.flush(), closeRemote: () => remote.close(), remoteEnabled: () => remote.enabled(), cleanExpiredSessions, randomCheckCode, SCHEMA_VERSION,
  acquireLock, releaseLock, activeLock,
  get DATA_DIR() { return DATA_DIR; },
  get DB_FILE() { return DB_FILE; },
  get UPLOAD_DIR() { return UPLOAD_DIR; }
};
