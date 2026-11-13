#!/usr/bin/env node
// Backup simples: copia a pasta de dados (banco + fotos) para backups/foodfind-AAAAMMDD-HHMMSS.
// Pasta de dados: FOODFIND_DATA_DIR (padrão ./data). Destino: FOODFIND_BACKUP_DIR (padrão ./backups).
// O banco é gravado de forma atômica (arquivo temporário + rename), então a cópia é sempre consistente.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const dataDir = path.resolve(process.env.FOODFIND_DATA_DIR || path.join(ROOT, 'data'));
const backupRoot = path.resolve(process.env.FOODFIND_BACKUP_DIR || path.join(ROOT, 'backups'));

if (!fs.existsSync(path.join(dataDir, 'foodfind.db'))) {
  console.error(`Nenhum banco encontrado em ${dataDir}. Nada para copiar.`);
  process.exit(1);
}

const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
}).formatToParts(new Date()).map(x => [x.type, x.value]));
const baseName = path.join(backupRoot, `foodfind-${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}`);
let dest = baseName;
for (let i = 2; fs.existsSync(dest); i++) dest = `${baseName}-${i}`;

fs.mkdirSync(dest, { recursive: true });
// Copia item por item para poder pular a pasta de backups quando ela fica dentro da pasta de dados (Docker).
for (const entry of fs.readdirSync(dataDir)) {
  const src = path.join(dataDir, entry);
  const abs = path.resolve(src);
  if (abs === backupRoot || backupRoot.startsWith(abs + path.sep) || entry.endsWith('.tmp') || entry.endsWith('.lock')) continue;
  fs.cpSync(src, path.join(dest, entry), { recursive: true });
}
const size = fs.statSync(path.join(dest, 'foodfind.db')).size;
const photos = fs.existsSync(path.join(dest, 'uploads')) ? fs.readdirSync(path.join(dest, 'uploads')).length : 0;
console.log(`Backup criado em ${dest} (banco: ${(size / 1024).toFixed(1)} KB, fotos: ${photos}).`);
