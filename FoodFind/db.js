// Banco de dados SQLite do FoodFind.
// Usa o sql.js (SQLite compilado para WebAssembly), então não precisa instalar
// nenhum programa extra: o `npm install` já resolve tudo, inclusive no Windows.
// O banco fica salvo no arquivo data/foodfind.db e pode ser aberto em
// programas como o "DB Browser for SQLite" para consultar os dados.
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'foodfind.db');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

let db;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'cliente',   -- 'cliente' ou 'restaurante'
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS restaurants (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id     INTEGER NOT NULL,
  osm_ref      TEXT UNIQUE,          -- preenchido quando o restaurante já existia no OpenStreetMap
  name         TEXT NOT NULL,
  category     TEXT,
  cuisine      TEXT,
  description  TEXT,
  website      TEXT,                 -- URL para onde o botão "Visitar site" redireciona
  phone        TEXT,
  whatsapp     TEXT,
  instagram    TEXT,
  delivery_url TEXT,
  menu_url     TEXT,
  price_range  TEXT,
  address      TEXT,
  lat          REAL NOT NULL,
  lng          REAL NOT NULL,
  hours        TEXT,                 -- JSON com o horário de cada dia da semana
  menu         TEXT,                 -- JSON com os itens do cardápio
  photos       TEXT,                 -- JSON com a lista de fotos (a primeira é a capa)
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
`;

async function init() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const SQL = await initSqlJs();
  db = fs.existsSync(DB_FILE) ? new SQL.Database(fs.readFileSync(DB_FILE)) : new SQL.Database();
  db.run(SCHEMA);
  db.run('DELETE FROM sessions WHERE expires_at < ?', [Date.now()]);
  save();
}

// Grava o banco no disco depois de cada alteração.
function save() {
  const data = Buffer.from(db.export());
  const tmp = DB_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, DB_FILE);
  } catch {
    fs.writeFileSync(DB_FILE, data); // fallback (ex.: antivírus bloqueando o rename no Windows)
  }
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function get(sql, params = []) {
  return all(sql, params)[0] || null;
}

// Executa INSERT/UPDATE/DELETE, salva no disco e devolve o id inserido.
function run(sql, params = []) {
  db.run(sql, params);
  const lastId = get('SELECT last_insert_rowid() AS id').id;
  save();
  return lastId;
}

module.exports = { init, all, get, run, UPLOAD_DIR };
