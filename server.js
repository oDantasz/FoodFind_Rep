const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const root = path.join(__dirname, 'public');
const DEFAULT_LOCATION = { lat: -23.5613, lng: -46.6565 };

function send(res, code, data, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const p = Math.PI / 180;
  const a = 0.5 - Math.cos((lat2-lat1)*p)/2 + Math.cos(lat1*p)*Math.cos(lat2*p)*(1-Math.cos((lon2-lon1)*p))/2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function fetchRestaurants(lat, lng, q = '') {
  const radius = 4000;
  const query = `
    [out:json][timeout:20];
    (
      nwr[amenity~"restaurant|fast_food|cafe"](around:${radius},${lat},${lng});
    );
    out center tags;
  `;
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'User-Agent': 'FoodFind-Sprint1/1.1' },
    body: query
  });
  if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
  const data = await response.json();
  const term = q.trim().toLowerCase();
  return data.elements.map((el, i) => {
    const t = el.tags || {};
    const rlat = Number(el.lat ?? el.center?.lat);
    const rlng = Number(el.lon ?? el.center?.lon);
    const name = t.name || t['name:pt'] || 'Restaurante sem nome';
    const category = t.amenity === 'cafe' ? 'Café' : t.amenity === 'fast_food' ? 'Fast-food' : 'Restaurante';
    const distanceKm = haversine(lat, lng, rlat, rlng);
    const address = [t['addr:street'], t['addr:housenumber'], t['addr:neighbourhood'], t['addr:city']].filter(Boolean).join(', ') || 'Endereço não informado';
    const website = t.website || t['contact:website'] || '';
    const phone = t.phone || t['contact:phone'] || 'Telefone não informado';
    const rating = t.stars ? Number(t.stars) : null;
    return {
      id: `${el.type}-${el.id}`,
      osmType: el.type,
      osmId: el.id,
      name, category, rating: Number.isFinite(rating) ? rating : null,
      distance: distanceKm < 1 ? `${Math.round(distanceKm*1000)} m` : `${distanceKm.toFixed(1).replace('.', ',')} km`,
      distanceKm, address, phone,
      hours: t.opening_hours || 'Horário não informado',
      description: t.cuisine ? `Culinária: ${t.cuisine.replaceAll(';', ', ')}.` : 'Estabelecimento encontrado no OpenStreetMap.',
      website, lat: rlat, lng: rlng,
      image: ''
    };
  }).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng) && (!term || `${r.name} ${r.category} ${r.description}`.toLowerCase().includes(term)))
    .sort((a,b) => a.distanceKm - b.distanceKm)
    .slice(0, 40);
}

async function server(req, res) {
  try {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname === '/api/restaurants') {
      const lat = Number(u.searchParams.get('lat')) || DEFAULT_LOCATION.lat;
      const lng = Number(u.searchParams.get('lng')) || DEFAULT_LOCATION.lng;
      const q = u.searchParams.get('q') || '';
      try {
        const restaurants = await fetchRestaurants(lat, lng, q);
        return send(res, 200, { source: 'OpenStreetMap/Overpass', center: {lat, lng}, restaurants });
      } catch (e) {
        console.error(e);
        return send(res, 502, { message: 'Não foi possível consultar restaurantes reais agora. Tente novamente em alguns segundos.' });
      }
    }

    if (u.pathname === '/api/health') return send(res, 200, { ok: true });

    let p = path.join(root, u.pathname === '/' ? 'index.html' : u.pathname);
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(root, 'index.html');
    const ext = path.extname(p);
    const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml' };
    send(res, 200, fs.readFileSync(p), types[ext] || 'application/octet-stream');
  } catch (e) {
    console.error(e);
    send(res, 500, { message: 'Erro interno.' });
  }
}

http.createServer(server).listen(PORT, () => console.log(`FoodFind em http://localhost:${PORT}`));
