// Service worker do FoodFind: guarda só o "shell" do app (HTML, CSS, JS, fontes e ícones).
// A API (/api/), os tiles do mapa e as fotos nunca são guardados em cache.
const VERSION = '4.0.0';
const CACHE = `foodfind-shell-${VERSION}`;
const SHELL = [
  '/', '/index.html', `/styles.css?v=${VERSION}`, `/app.js?v=${VERSION}`, `/glassfold.js?v=${VERSION}`, `/fluxo.js?v=${VERSION}`, '/manifest.webmanifest',
  '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png',
  '/fonts/barlow-latin-400-normal.woff2', '/fonts/barlow-latin-600-normal.woff2', '/fonts/barlow-condensed-latin-700-normal.woff2'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('foodfind-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/tiles/') || url.pathname.startsWith('/uploads/')) return;

  // Páginas: rede primeiro (conteúdo sempre atualizado); sem rede, usa o shell guardado.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }
  // Arquivos do shell: rede primeiro (sempre a versão mais nova); sem rede, usa o cache.
  event.respondWith(
    fetch(req).then(res => {
      if (res.ok && SHELL.includes(url.pathname + url.search)) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
