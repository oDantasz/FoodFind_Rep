// Helpers HTTP: send, httpError, readBody e envio de arquivos estáticos.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function httpError(status, message, code, extra) {
  return Object.assign(new Error(message), { status, code, ...extra });
}

function send(res, code, data, type = 'application/json; charset=utf-8', extraHeaders = {}) {
  if (res.headersSent) return;
  const body = type.startsWith('application/json') ? JSON.stringify(data) : data;
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(body);
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '');
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) {
      req.resume();
      return reject(httpError(413, 'Arquivo ou dados grandes demais.', 'too_large'));
    }
    let size = 0;
    let failed = false;
    const chunks = [];
    req.on('data', c => {
      if (failed) return;
      size += c.length;
      if (size > limit) {
        failed = true;
        reject(httpError(413, 'Arquivo ou dados grandes demais.', 'too_large'));
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (failed) return;
      if (!chunks.length) return resolve({});
      // Exigir JSON impede envios de formulários de outros sites (CSRF).
      if (!/^application\/json\b/i.test(type)) return reject(httpError(415, 'Envie os dados em JSON (Content-Type: application/json).', 'bad_content_type'));
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
      } catch {
        reject(httpError(400, 'JSON inválido.', 'bad_json'));
      }
    });
    req.on('error', e => { if (!failed) reject(e); });
  });
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.webmanifest', '.svg', '.txt']);
const gzipCache = new Map();

// Envia um arquivo de forma assíncrona, com gzip quando o navegador aceita.
async function sendFile(req, res, file, headers = {}) {
  const stat = await fs.promises.stat(file);
  const ext = path.extname(file).toLowerCase();
  const type = TYPES[ext] || 'application/octet-stream';
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const base = { 'Content-Type': type, ETag: etag, Vary: 'Accept-Encoding', ...headers };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, base);
    return res.end();
  }
  const wantsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
  if (wantsGzip && COMPRESSIBLE.has(ext) && stat.size > 512) {
    const key = `${file}:${etag}`;
    let gz = gzipCache.get(key);
    if (!gz) {
      const raw = await fs.promises.readFile(file);
      gz = await new Promise((resolve, reject) => zlib.gzip(raw, { level: 6 }, (e, out) => (e ? reject(e) : resolve(out))));
      if (gzipCache.size > 100) gzipCache.delete(gzipCache.keys().next().value);
      gzipCache.set(key, gz);
    }
    res.writeHead(200, { ...base, 'Content-Encoding': 'gzip', 'Content-Length': gz.length });
    return res.end(req.method === 'HEAD' ? undefined : gz);
  }
  res.writeHead(200, { ...base, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    res.on('close', resolve);
    stream.pipe(res);
  });
}

module.exports = { httpError, send, readBody, sendFile, TYPES };
