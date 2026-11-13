// Persistência externa (opcional) em PostgreSQL.
//
// Hospedagens gratuitas como o Render apagam o disco ao reiniciar ou "dormir". Quando a
// variável DATABASE_URL está definida (ex.: um banco gratuito do Neon), o FoodFind continua
// usando o SQLite em memória (sql.js), mas guarda no PostgreSQL:
//   - uma cópia do banco inteiro (foodfind.db) a cada alteração;
//   - as fotos enviadas (pasta uploads) e o cache do OpenStreetMap.
// Na inicialização, essas cópias são baixadas para a pasta de dados antes de abrir o banco.
//
// Segurança dos dados:
//   - Se DATABASE_URL estiver definida e o PostgreSQL não responder na inicialização, o processo
//     PARA com erro, em vez de subir com um banco vazio que sobrescreveria a cópia boa.
//   - Cada processo que abre o banco "assume" a cópia (coluna owner). Um processo antigo
//     (ex.: durante um novo deploy) deixa de gravar quando outro assume, para não sobrescrevê-lo.
//   - O endereço do banco nunca é escrito em log.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE_NAME = /^(uploads\/[a-f0-9-]{36}\.(jpg|png|webp)|osm-cache\.json)$/;

let pool = null;
let owner = null;
let dataDir = '';
let lostOwnership = false;
let pendingDb = null;
let writing = null;
let timer = null;
const remoteFiles = new Set();

function enabled() { return Boolean(process.env.DATABASE_URL); }

function log(msg) { console.log(`[persistência] ${msg}`); }
function logErr(msg, e) { console.error(`[persistência] ${msg}: ${e && e.message ? String(e.message).replace(/postgres(ql)?:\/\/\S+/gi, '[endereço oculto]') : e}`); }

async function connect() {
  if (pool) return pool;
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 20000, idleTimeoutMillis: 10000 });
  pool.on('error', e => logErr('conexão com o PostgreSQL', e));
  await pool.query(`
    CREATE TABLE IF NOT EXISTS foodfind_snapshot (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data BYTEA,
      owner TEXT,
      saved_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS foodfind_files (
      name TEXT PRIMARY KEY,
      data BYTEA NOT NULL,
      saved_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);
  return pool;
}

// Baixa o banco e os arquivos guardados para a pasta de dados e assume a gravação.
async function restore(dir) {
  dataDir = dir;
  const p = await connect();
  owner = `${require('os').hostname()}:${process.pid}:${crypto.randomBytes(6).toString('hex')}`;
  const r = await p.query(`INSERT INTO foodfind_snapshot (id, owner) VALUES (1, $1)
    ON CONFLICT (id) DO UPDATE SET owner = EXCLUDED.owner RETURNING data`, [owner]);
  const data = r.rows[0] && r.rows[0].data;
  if (data && data.length) fs.writeFileSync(path.join(dir, 'foodfind.db'), data);
  const files = await p.query('SELECT name, data FROM foodfind_files');
  for (const f of files.rows) {
    if (!FILE_NAME.test(f.name)) continue;
    const target = path.join(dir, f.name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.data);
    remoteFiles.add(f.name);
  }
  log(data && data.length ? `banco restaurado do PostgreSQL (${Math.round(data.length / 1024)} KB, ${files.rowCount} arquivo(s))` : 'nenhuma cópia no PostgreSQL ainda; começando com banco novo');
}

// Agenda o envio do banco (o mais recente vence; gravações em sequência, nunca em paralelo).
function queueDb(buffer) {
  if (!pool || lostOwnership) return;
  pendingDb = buffer;
  if (!timer) timer = setTimeout(() => { timer = null; drain(); }, 250);
}

function drain() {
  if (writing) return writing;
  writing = (async () => {
    try {
      while (pendingDb && !lostOwnership) {
        const data = pendingDb;
        pendingDb = null;
        const r = await pool.query('UPDATE foodfind_snapshot SET data = $1, saved_at = now() WHERE id = 1 AND owner = $2', [data, owner]);
        if (r.rowCount === 0) {
          lostOwnership = true;
          log('outro processo assumiu o banco (novo deploy); este processo deixa de gravar.');
          break;
        }
        await syncUploads();
      }
    } catch (e) {
      logErr('não foi possível salvar no PostgreSQL; nova tentativa em 5 s', e);
      if (!pendingDb) pendingDb = Buffer.from(fs.readFileSync(path.join(dataDir, 'foodfind.db')));
      setTimeout(() => drain(), 5000).unref();
    } finally {
      writing = null;
    }
  })();
  return writing;
}

// Envia fotos novas e apaga do PostgreSQL as que saíram da pasta.
async function syncUploads() {
  const dir = path.join(dataDir, 'uploads');
  let local = [];
  try { local = fs.readdirSync(dir).map(f => `uploads/${f}`).filter(n => FILE_NAME.test(n)); } catch { /* pasta vazia */ }
  const localSet = new Set(local);
  for (const name of local) {
    if (remoteFiles.has(name)) continue;
    await pool.query('INSERT INTO foodfind_files (name, data) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, saved_at = now()', [name, fs.readFileSync(path.join(dataDir, name))]);
    remoteFiles.add(name);
  }
  for (const name of [...remoteFiles]) {
    if (!name.startsWith('uploads/') || localSet.has(name)) continue;
    await pool.query('DELETE FROM foodfind_files WHERE name = $1', [name]);
    remoteFiles.delete(name);
  }
}

// Guarda um arquivo avulso (usado para o cache do OpenStreetMap).
function putFile(name, data) {
  if (!pool || lostOwnership || !FILE_NAME.test(name)) return;
  pool.query('INSERT INTO foodfind_files (name, data) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, saved_at = now()', [name, Buffer.from(data)])
    .then(() => remoteFiles.add(name))
    .catch(e => logErr(`não foi possível salvar ${name}`, e));
}

// Espera as gravações pendentes (encerramento do servidor ou fim do seed).
async function flush() {
  if (!pool) return;
  if (timer) { clearTimeout(timer); timer = null; }
  await drain();
  if (pendingDb && !lostOwnership) await drain();
  if (!lostOwnership) await syncUploads().catch(e => logErr('fotos', e));
}

async function close() {
  if (!pool) return;
  await flush();
  await pool.end().catch(() => {});
  pool = null;
}

module.exports = { enabled, restore, queueDb, putFile, flush, close };
