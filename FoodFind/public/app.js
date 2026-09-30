let map, markers = [], userMarker = null, userLocation = null, currentRestaurants = [];
let me = null;
let currentDetailId = null;
const PAGE_SIZE = 10;
let visibleCount = PAGE_SIZE;
const DEFAULT_LOC = { lat: -23.5613, lng: -46.6565 };
const DAYS = [['seg', 'Segunda'], ['ter', 'Terça'], ['qua', 'Quarta'], ['qui', 'Quinta'], ['sex', 'Sexta'], ['sab', 'Sábado'], ['dom', 'Domingo']];
const $ = x => document.getElementById(x);

const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const TILE_PROVIDERS = [
  { name: 'CARTO', url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', options: { subdomains: 'abcd', maxZoom: 20, attribution: `${OSM_ATTR} &copy; <a href="https://carto.com/attributions">CARTO</a>` } },
  { name: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', options: { maxZoom: 19, attribution: OSM_ATTR } },
  { name: 'Esri', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', options: { maxZoom: 19, attribution: 'Mapa &copy; Esri' } },
  { name: 'Stadia', url: 'https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}{r}.png', options: { maxZoom: 20, attribution: `${OSM_ATTR} &copy; <a href="https://stadiamaps.com/">Stadia Maps</a>` } },
  { name: 'Servidor FoodFind', url: '/tiles/{z}/{x}/{y}', options: { maxZoom: 19, attribution: OSM_ATTR } }
];

function savedProvider() {
  try { const i = Number(localStorage.getItem('ff_tile_provider')); return i >= 0 && i < TILE_PROVIDERS.length ? i : 0; } catch { return 0; }
}

function showMapAlert(m, show) {
  if (m._ffAlert) { m.removeControl(m._ffAlert); m._ffAlert = null; }
  if (!show) return;
  const ctrl = L.control({ position: 'topright' });
  ctrl.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-alert');
    div.innerHTML = `<b>O desenho do mapa não carregou.</b>
      <span>Nenhum dos ${TILE_PROVIDERS.length} servidores de mapa respondeu. A rede, o antivírus ou um bloqueador de anúncios pode estar bloqueando.</span>
      <div><button type="button" data-act="retry">Tentar de novo</button><a href="/api/map-check" target="_blank" rel="noopener">Ver diagnóstico</a></div>`;
    L.DomEvent.disableClickPropagation(div);
    div.querySelector('[data-act=retry]').onclick = () => {
      try { localStorage.removeItem('ff_tile_provider'); } catch { }
      showMapAlert(m, false);
      if (m._ffLayer) m.removeLayer(m._ffLayer);
      addBaseLayer(m, 0, 0);
    };
    return div;
  };
  ctrl.addTo(m);
  m._ffAlert = ctrl;
}

function addBaseLayer(m, i = savedProvider(), tried = 0) {
  const p = TILE_PROVIDERS[i];
  const layer = L.tileLayer(p.url, p.options).addTo(m);
  m._ffLayer = layer;
  let loaded = 0, errors = 0, done = false;
  const next = reason => {
    if (done || loaded) return;
    done = true;
    m.removeLayer(layer);
    console.warn(`Mapa: ${p.name} não carregou (${reason}).`);
    if (tried + 1 >= TILE_PROVIDERS.length) {
      console.error('Mapa: nenhum provedor respondeu. Abra /api/map-check para ver o diagnóstico do servidor.');
      showMapAlert(m, true);
      return;
    }
    addBaseLayer(m, (i + 1) % TILE_PROVIDERS.length, tried + 1);
  };
  layer.on('tileload', () => {
    if (!loaded++) {
      console.info(`Mapa: usando ${p.name}.`);
      try { localStorage.setItem('ff_tile_provider', String(i)); } catch { }
    }
  });
  layer.on('tileerror', () => { if (++errors >= 3) next('erro ao baixar as imagens'); });
  setTimeout(() => next('sem resposta em 8 segundos'), 8000);
  return layer;
}

map = L.map('map', { maxZoom: 19 }).setView([DEFAULT_LOC.lat, DEFAULT_LOC.lng], 14);
addBaseLayer(map);

const registeredIcon = L.divIcon({ className: 'ff-pin', html: '<span><i>★</i></span>', iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -28] });

function setStatus(text = '', kind = '') { $('status').textContent = text; $('status').className = `status ${kind}`; }
function escapeHtml(s = '') { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function money(v) { return v == null ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

async function apiFetch(url, options = {}) {
  const res = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || 'Erro na requisição.'), { status: res.status, code: data.code });
  return data;
}

function renderAccount() {
  $('accountArea').innerHTML = me
    ? `<span class="user">Olá, ${escapeHtml(me.name.split(' ')[0])}</span>
       ${me.role === 'restaurante' ? '<button class="account-btn primary-btn" onclick="openPanel()">🏪 Meu restaurante</button>' : ''}
       <button class="account-btn" onclick="logout()">Sair</button>`
    : `<button class="account-btn" onclick="openAuthModal('login')">Entrar</button>
       <button class="account-btn primary-btn" onclick="openAuthModal('register')">Criar conta</button>`;
}

function openAuthModal(mode = 'login', role) {
  clearAuthError();
  switchTab(mode);
  if (role) document.querySelector(`input[name="regRole"][value="${role}"]`).checked = true;
  $('authModal').classList.remove('hide');
}
function closeAuthModal() { $('authModal').classList.add('hide'); clearAuthError(); }
function handleOverlayClick(e) { if (e.target.id === 'authModal') closeAuthModal(); }
function clearAuthError() { $('modalError').textContent = ''; $('modalError').classList.add('hide'); }
function showAuthError(msg) { $('modalError').textContent = msg; $('modalError').classList.remove('hide'); }

function switchTab(mode) {
  clearAuthError();
  const login = mode === 'login';
  $('tabLogin').classList.toggle('active', login);
  $('tabRegister').classList.toggle('active', !login);
  $('formLogin').classList.toggle('hide', !login);
  $('formRegister').classList.toggle('hide', login);
}

async function handleRegister(e) {
  e.preventDefault();
  try {
    const data = await apiFetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: $('regName').value.trim(), email: $('regEmail').value.trim(), password: $('regPassword').value,
        role: document.querySelector('input[name="regRole"]:checked').value
      })
    });
    me = data.user;
    afterLoginChange();
    closeAuthModal();
    $('formRegister').reset(); $('formLogin').reset();
    setStatus(`Conta criada com sucesso! Olá, ${me.name}.`, 'success');
    if (me.role === 'restaurante') openPanel();
  } catch (err) { showAuthError(err.message); }
}

async function handleLogin(e) {
  e.preventDefault();
  const email = $('loginEmail').value.trim();
  try {
    const data = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: $('loginPassword').value }) });
    me = data.user;
    afterLoginChange();
    closeAuthModal();
    $('formLogin').reset();
    setStatus(`Bem-vindo(a) de volta, ${me.name}!`, 'success');
  } catch (err) {
    showAuthError(err.message);
    if (err.code === 'no_account') setTimeout(() => { switchTab('register'); $('regEmail').value = email; }, 1800);
  }
}

async function logout() {
  await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  me = null;
  afterLoginChange();
  if (!$('panel').classList.contains('hide')) home();
  setStatus('Você saiu da conta.');
}

function afterLoginChange() {
  renderAccount();
  if (currentDetailId && !$('detail').classList.contains('hide')) openR(currentDetailId);
}

function showView(view) {
  $('homeGrid').classList.toggle('hide', view !== 'home');
  document.querySelector('.search').classList.toggle('hide', view !== 'home');
  document.querySelector('.hero').classList.toggle('hide', view !== 'home');
  $('status').classList.toggle('hide', view === 'detail');
  $('detail').className = view === 'detail' ? 'detail' : 'hide';
  $('panel').classList.toggle('hide', view !== 'panel');
  if (view === 'home') setTimeout(() => map.invalidateSize(), 50);
  scrollTo(0, 0);
}

function home() { currentDetailId = null; showView('home'); }

function useMyLocation() {
  if (!navigator.geolocation) return setStatus('Seu navegador não oferece geolocalização.', 'error');
  setStatus('Solicitando sua localização...');
  navigator.geolocation.getCurrentPosition(pos => {
    userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    map.setView([userLocation.lat, userLocation.lng], 15);
    if (userMarker) map.removeLayer(userMarker);
    userMarker = L.circleMarker([userLocation.lat, userLocation.lng], { radius: 9 }).addTo(map).bindPopup('📍 Você está aqui').openPopup();
    setStatus('Localização encontrada. Buscando restaurantes próximos...', 'success');
    loadRestaurants();
  }, err => {
    const msg = err.code === 1 ? 'Permissão de localização negada. Libere a localização do navegador e tente novamente.' : 'Não foi possível obter sua localização.';
    setStatus(msg, 'error');
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}

async function loadRestaurants({ keepPage = false, silent = false } = {}) {
  const q = $('q').value.trim();
  const loc = userLocation || DEFAULT_LOC;
  if (!silent) setStatus('Consultando restaurantes próximos...');
  try {
    const data = await apiFetch(`/api/restaurants?lat=${loc.lat}&lng=${loc.lng}&q=${encodeURIComponent(q)}`);
    currentRestaurants = data.restaurants || [];
    if (!keepPage) visibleCount = PAGE_SIZE;
    renderList();
    const mapShown = map.getContainer().clientWidth > 0;
    if (mapShown && !userLocation && currentRestaurants.length && !keepPage) map.fitBounds(L.latLngBounds(currentRestaurants.slice(0, visibleCount).map(r => [r.lat, r.lng])).pad(.15));
    if (mapShown) setTimeout(() => map.invalidateSize(), 200);
    const cadastrados = currentRestaurants.filter(r => r.registered).length;
    if (data.warning) setStatus(data.warning, 'error');
    else if (!silent) setStatus(`${currentRestaurants.length} estabelecimento(s) encontrado(s)${cadastrados ? ` • ${cadastrados} cadastrado(s) no FoodFind` : ''}.`, 'success');
  } catch (e) {
    console.error(e);
    $('list').innerHTML = '<p class="mut">Não foi possível carregar os restaurantes agora. Verifique sua internet e tente novamente.</p>';
    setStatus(e.message, 'error');
  }
}

function renderList() {
  const total = currentRestaurants.length;
  const shown = currentRestaurants.slice(0, visibleCount);
  $('count').textContent = `(${total})`;
  if (!total) {
    $('list').innerHTML = '<p class="mut">Nenhum estabelecimento encontrado. Tente outra busca.</p>';
  } else {
    const remaining = total - shown.length;
    $('list').innerHTML = shown.map(card).join('') + (remaining > 0
      ? `<button class="more-btn" onclick="showMore()">
           <span>Ver mais</span>
           <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
           <small>Mostrando ${shown.length} de ${total}</small>
         </button>`
      : (total > PAGE_SIZE ? `<p class="list-end">Você viu todos os ${total} restaurantes.</p>` : ''));
  }
  renderMarkers(shown);
}

function showMore() {
  visibleCount += PAGE_SIZE;
  renderList();
}

function renderMarkers(list) {
  markers.forEach(m => map.removeLayer(m));
  markers = list.map(r => {
    const opts = r.registered ? { icon: registeredIcon } : {};
    return L.marker([r.lat, r.lng], opts).addTo(map)
      .bindPopup(`<b>${escapeHtml(r.name)}</b><br>${escapeHtml(r.distance)}<br><button class="popup-btn" onclick="openR('${r.id}')">Ver perfil</button>`);
  });
}

function todayKey(d = new Date()) { return ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'][d.getDay()]; }
function toMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }

function isOpenNow(schedule) {
  if (!schedule) return null;
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const today = schedule[todayKey(now)];
  const yesterday = schedule[todayKey(new Date(now.getTime() - 86400000))];
  if (today && !today.closed) {
    const o = toMin(today.open), c = toMin(today.close);
    if (c > o ? mins >= o && mins < c : mins >= o) return true;
  }
  if (yesterday && !yesterday.closed && toMin(yesterday.close) <= toMin(yesterday.open) && mins < toMin(yesterday.close)) return true;
  return false;
}

function todayHoursText(schedule) {
  const t = schedule && schedule[todayKey()];
  if (!t) return 'Horário não informado';
  return t.closed ? 'Fechado hoje' : `Hoje: ${t.open} às ${t.close}`;
}

function hasSchedule(schedule) { return schedule && Object.values(schedule).some(d => !d.closed); }

function card(r) {
  const rating = r.rating ? `★ ${r.rating}` : '☆ Sem avaliação';
  const emoji = r.category === 'Café' ? '☕' : ['Fast-food', 'Lanchonete'].includes(r.category) ? '🍔' : r.category === 'Pizzaria' ? '🍕' : '🍽️';
  const thumb = r.image ? `<img class="food-icon food-img" src="${escapeHtml(r.image)}" alt="" loading="lazy">` : `<div class="food-icon">${emoji}</div>`;
  const open = r.registered && hasSchedule(r.schedule) ? (isOpenNow(r.schedule) ? '<span class="open-tag on">Aberto agora</span>' : '<span class="open-tag off">Fechado agora</span>') : '';
  return `<article class="item${r.registered ? ' registered' : ''}" onclick="openR('${r.id}')">${thumb}<div>
    <h3>${escapeHtml(r.name)}</h3>
    <div class="mut">${escapeHtml(r.category)}${r.priceRange ? ` · ${escapeHtml(r.priceRange)}` : ''}${r.registered ? ' · <span class="verified">✔ Cadastrado</span>' : ''}</div>
    <div class="rating">${rating}</div>
    <div class="mut">📍 ${escapeHtml(r.distance)} ${open}</div>
  </div></article>`;
}

function findR(id) { return currentRestaurants.find(r => String(r.id) === String(id)); }

async function openR(id) {
  let r = findR(id);
  if (!r && String(id).startsWith('ff-')) {
    const loc = userLocation || DEFAULT_LOC;
    try { r = (await apiFetch(`/api/restaurants/${id}?lat=${loc.lat}&lng=${loc.lng}`)).restaurant; } catch { }
  }
  if (!r) return;
  currentDetailId = id;
  map.closePopup();
  $('detail').innerHTML = r.registered ? registeredDetail(r) : osmDetail(r);
  showView('detail');
}

function ownerActions(r) {
  if (r.registered) {
    return me && me.id === r.ownerId ? `<button class="primary" onclick="editRestaurant(${r.id.slice(3)})">✏️ Editar informações</button>` : '';
  }
  if (me && me.role === 'restaurante') return `<div class="claim-box">🏪 <div><b>Este restaurante é seu?</b><br><span class="mut">Assuma o perfil para adicionar fotos, cardápio, horários e o link do seu site.</span></div><button class="primary" onclick="claimRestaurant('${r.id}')">Assumir e editar</button></div>`;
  if (!me) return `<div class="claim-box">🏪 <div><b>É o dono deste lugar?</b><br><span class="mut">Crie uma conta de restaurante para atualizar as informações dele.</span></div><button class="primary" onclick="openAuthModal('register','restaurante')">Criar conta de restaurante</button></div>`;
  return '';
}

function osmDetail(r) {
  const rating = r.rating ? `★ ${r.rating}` : '☆ Sem avaliação cadastrada';
  const website = r.website ? `<a class="primary-link" href="${escapeHtml(r.website)}" target="_blank" rel="noopener">🌐 Site do estabelecimento ↗</a>` : '<span class="mut">Site não informado</span>';
  return `<button class="back" onclick="home()">← Voltar</button><div class="detail-card"><div class="detail-cover">🍽️</div><div class="body">
    <small>${escapeHtml(r.category).toUpperCase()}</small><h1>${escapeHtml(r.name)}</h1><p>${escapeHtml(r.description)}</p>
    <div class="pills"><span class="pill">${rating}</span><span class="pill">📍 ${escapeHtml(r.address)}</span><span class="pill">📞 ${escapeHtml(r.phone)}</span><span class="pill">🕐 ${escapeHtml(r.hours)}</span></div>
    ${ownerActions(r)}
    <div class="cols"><div><h2>Informações</h2><p>Distância: <b>${escapeHtml(r.distance)}</b></p><p>${website}</p><p class="mut">Dados públicos do OpenStreetMap. Algumas informações podem não estar cadastradas.</p></div>
    <div><h2>🍽️ Cardápio</h2><p class="mut">O cardápio não está disponível nos dados públicos deste estabelecimento.</p><p>O FoodFind não processa pedidos. Quando houver site informado, o usuário pode acessar o estabelecimento por lá.</p></div></div>
  </div></div>`;
}

function registeredDetail(r) {
  const photos = r.photos || [];
  const cover = photos.length ? `<div class="detail-cover has-photo" id="detailCover" style="background-image:url('${escapeHtml(photos[0])}')"></div>` : `<div class="detail-cover">🍽️</div>`;
  const gallery = photos.length > 1 ? `<div class="gallery">${photos.map((p, i) => `<img src="${escapeHtml(p)}" alt="Foto ${i + 1}" class="${i === 0 ? 'active' : ''}" onclick="setCover(this)">`).join('')}</div>` : '';
  const open = hasSchedule(r.schedule) ? (isOpenNow(r.schedule) ? '<span class="pill open">● Aberto agora</span>' : '<span class="pill closed">● Fechado agora</span>') : '';
  const wa = r.whatsapp ? `https://wa.me/${r.whatsapp.length <= 11 ? '55' : ''}${r.whatsapp}` : '';
  const btn = (href, label, cls = 'action-btn') => href ? `<a class="${cls}" href="${escapeHtml(href)}" target="_blank" rel="noopener">${label}</a>` : '';
  const actions = [
    btn(r.website, '🌐 Visitar site ↗', 'action-btn main'),
    btn(r.deliveryUrl, '🛵 Pedir delivery'),
    btn(wa, '💬 WhatsApp'),
    btn(r.instagram, '📸 Instagram'),
    btn(r.menuUrl, '📄 Cardápio completo'),
    btn(`https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}`, '🧭 Como chegar')
  ].join('');

  const tk = todayKey();
  const hoursTable = hasSchedule(r.schedule)
    ? `<table class="hours-table">${DAYS.map(([k, label]) => { const d = r.schedule[k] || { closed: true }; return `<tr class="${k === tk ? 'today' : ''}"><td>${label}</td><td>${d.closed ? 'Fechado' : `${d.open} às ${d.close}`}</td></tr>`; }).join('')}</table>`
    : '<p class="mut">Horários não informados.</p>';

  const sections = {};
  (r.menu || []).forEach(i => (sections[i.section] = sections[i.section] || []).push(i));
  const menuHtml = Object.keys(sections).length
    ? Object.entries(sections).map(([s, items]) => `<div class="menu-section"><h3>${escapeHtml(s)}</h3>${items.map(i => `<div class="menu-item"><div><b>${escapeHtml(i.name)}</b>${i.description ? `<p class="mut">${escapeHtml(i.description)}</p>` : ''}</div><span class="price">${money(i.price)}</span></div>`).join('')}</div>`).join('')
    : `<p class="mut">Este restaurante ainda não cadastrou o cardápio.</p>`;

  return `<button class="back" onclick="home()">← Voltar</button><div class="detail-card">${cover}<div class="body">
    ${gallery}
    <small>${escapeHtml(r.category).toUpperCase()}${r.cuisine ? ` · ${escapeHtml(r.cuisine).toUpperCase()}` : ''}</small>
    <h1>${escapeHtml(r.name)} <span class="verified-lg" title="Informações atualizadas pelo próprio restaurante">✔</span></h1>
    <p>${escapeHtml(r.description)}</p>
    <div class="pills">${open}${r.priceRange ? `<span class="pill">💰 ${escapeHtml(r.priceRange)}</span>` : ''}<span class="pill">📍 ${escapeHtml(r.address)}</span><span class="pill">📞 ${escapeHtml(r.phone)}</span><span class="pill">🕐 ${escapeHtml(todayHoursText(r.schedule))}</span></div>
    <div class="actions">${actions}</div>
    ${ownerActions(r)}
    <div class="cols">
      <div><h2>🕐 Horário de funcionamento</h2>${hoursTable}
        <h2 class="mt">Informações</h2>${r.distance ? `<p>Distância: <b>${escapeHtml(r.distance)}</b></p>` : ''}
        <p class="mut">Informações atualizadas pelo próprio restaurante${r.updatedAt ? ` em ${new Date(r.updatedAt).toLocaleDateString('pt-BR')}` : ''}.</p></div>
      <div><h2>🍽️ Cardápio</h2>${menuHtml}</div>
    </div>
  </div></div>`;
}

function setCover(img) {
  $('detailCover').style.backgroundImage = `url('${img.getAttribute('src')}')`;
  document.querySelectorAll('.gallery img').forEach(i => i.classList.toggle('active', i === img));
}

let myRestaurants = [];
let editing = null;
let rMap = null, rMarker = null;

async function openPanel() {
  if (!me || me.role !== 'restaurante') return openAuthModal('register', 'restaurante');
  showView('panel');
  $('rForm').classList.add('hide');
  await loadMyRestaurants();
}

async function loadMyRestaurants() {
  try {
    myRestaurants = (await apiFetch('/api/my/restaurants')).restaurants;
  } catch (e) { myRestaurants = []; $('myList').innerHTML = `<p class="modal-error">${escapeHtml(e.message)}</p>`; return; }
  $('myList').innerHTML = myRestaurants.length
    ? myRestaurants.map(r => `<article class="my-card">
        ${r.photos[0] ? `<img src="${escapeHtml(r.photos[0])}" alt="">` : '<div class="food-icon">🍽️</div>'}
        <div class="grow"><h3>${escapeHtml(r.name)}</h3><div class="mut">${escapeHtml(r.category)} · ${escapeHtml(r.address || 'Sem endereço')}</div>
        <div class="mut">${r.menu.length} item(ns) no cardápio · ${r.photos.length} foto(s) · atualizado em ${new Date(r.updatedAt).toLocaleString('pt-BR')}</div></div>
        <div class="my-actions"><button class="soft small" onclick="openR('${r.publicId}')">Ver perfil</button><button class="primary small" onclick="editRestaurant(${r.id})">Editar</button><button class="danger small" onclick="deleteRestaurant(${r.id})">Excluir</button></div>
      </article>`).join('')
    : '<div class="empty">Você ainda não cadastrou nenhum restaurante. Clique em <b>+ Cadastrar restaurante</b> para começar, ou abra um restaurante da lista e clique em <b>Assumir e editar</b> se ele já aparecer no mapa.</div>';
}

function emptyHours() { return Object.fromEntries(DAYS.map(([k]) => [k, { closed: false, open: '11:00', close: '22:00' }])); }

function fillForm(data) {
  editing = { id: data.id || null, osmRef: data.osmRef || null, photos: [...(data.photos || [])] };
  $('rFormTitle').textContent = data.id ? `Editar: ${data.name}` : 'Novo restaurante';
  $('rLinked').textContent = data.osmRef ? '🔗 Vinculado ao restaurante que já aparece no mapa' : '';
  $('rLinked').classList.toggle('hide', !data.osmRef);
  $('rError').classList.add('hide');
  $('rName').value = data.name || '';
  $('rCategory').value = data.category || 'Restaurante';
  $('rPrice').value = data.priceRange || '';
  $('rCuisine').value = data.cuisine || '';
  $('rDescription').value = data.description || '';
  $('rWebsite').value = data.website || '';
  $('rPhone').value = data.phone || '';
  $('rWhatsapp').value = data.whatsapp || '';
  $('rInstagram').value = data.instagram || '';
  $('rDelivery').value = data.deliveryUrl || '';
  $('rMenuUrl').value = data.menuUrl || '';
  $('rAddress').value = data.address || '';
  $('geoResults').classList.add('hide');
  renderHours(data.hours && Object.keys(data.hours).length ? data.hours : emptyHours());
  $('menuRows').innerHTML = '';
  (data.menu || []).forEach(addMenuItem);
  if (!(data.menu || []).length) addMenuItem();
  renderPhotos();

  $('rForm').classList.remove('hide');
  initFormMap();
  if (Number.isFinite(data.lat) && Number.isFinite(data.lng)) setFormLocation(data.lat, data.lng, 17);
  else { if (rMarker) { rMap.removeLayer(rMarker); rMarker = null; } const c = userLocation || map.getCenter(); rMap.setView([c.lat, c.lng], 14); updateCoordsText(); }
  $('rForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function newRestaurant() { fillForm({}); }

function editRestaurant(id) {
  const go = () => { const r = myRestaurants.find(x => x.id === id); if (r) fillForm(r); };
  if ($('panel').classList.contains('hide')) { showView('panel'); loadMyRestaurants().then(go); } else go();
}

async function claimRestaurant(osmId) {
  const r = findR(osmId);
  if (!r) return;
  showView('panel');
  await loadMyRestaurants();
  fillForm({
    osmRef: r.id, name: r.name, category: r.category, cuisine: r.cuisine,
    description: r.description && !r.description.startsWith('Estabelecimento encontrado') ? r.description : '',
    website: r.website, phone: r.phone !== 'Telefone não informado' ? r.phone : '',
    address: r.address !== 'Endereço não informado' ? r.address : '', lat: r.lat, lng: r.lng
  });
}

function cancelEdit() { $('rForm').classList.add('hide'); editing = null; scrollTo(0, 0); }

async function deleteRestaurant(id) {
  const r = myRestaurants.find(x => x.id === id);
  if (!r || !confirm(`Excluir "${r.name}" do FoodFind? Essa ação não pode ser desfeita.`)) return;
  try {
    await apiFetch(`/api/my/restaurants/${id}`, { method: 'DELETE' });
    if (editing && editing.id === id) cancelEdit();
    await loadMyRestaurants();
    loadRestaurants({ keepPage: true, silent: true });
  } catch (e) { alert(e.message); }
}

function initFormMap() {
  if (!rMap) {
    rMap = L.map('rMap', { maxZoom: 19 }).setView([DEFAULT_LOC.lat, DEFAULT_LOC.lng], 14);
    addBaseLayer(rMap);
    rMap.on('click', e => setFormLocation(e.latlng.lat, e.latlng.lng));
  }
  setTimeout(() => rMap.invalidateSize(), 60);
}

function setFormLocation(lat, lng, zoom) {
  if (!rMarker) {
    rMarker = L.marker([lat, lng], { draggable: true, icon: registeredIcon }).addTo(rMap);
    rMarker.on('dragend', updateCoordsText);
  } else rMarker.setLatLng([lat, lng]);
  rMap.setView([lat, lng], zoom || Math.max(rMap.getZoom(), 16));
  updateCoordsText();
}

function updateCoordsText() {
  $('rCoords').innerHTML = rMarker
    ? `✅ Localização marcada (${rMarker.getLatLng().lat.toFixed(5)}, ${rMarker.getLatLng().lng.toFixed(5)}). Arraste o marcador para ajustar.`
    : 'Clique no mapa para marcar onde fica o restaurante. Depois é só arrastar o marcador para ajustar.';
}

async function geocodeAddress() {
  const q = $('rAddress').value.trim();
  const box = $('geoResults');
  if (q.length < 3) return;
  box.innerHTML = '<span class="mut">Buscando endereço...</span>'; box.classList.remove('hide');
  try {
    const { results } = await apiFetch(`/api/geocode?q=${encodeURIComponent(q)}`);
    if (!results.length) { box.innerHTML = '<span class="mut">Endereço não encontrado. Tente incluir número, bairro e cidade, ou marque direto no mapa.</span>'; return; }
    box.innerHTML = results.map((r, i) => `<button type="button" data-i="${i}">📍 ${escapeHtml(r.label)}</button>`).join('');
    box.querySelectorAll('button').forEach(b => b.onclick = () => { const r = results[b.dataset.i]; setFormLocation(r.lat, r.lng, 17); box.classList.add('hide'); });
  } catch (e) { box.innerHTML = `<span class="mut">${escapeHtml(e.message)}</span>`; }
}

function useMyLocationForForm() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(p => setFormLocation(p.coords.latitude, p.coords.longitude, 17), () => alert('Não foi possível obter sua localização.'), { enableHighAccuracy: true, timeout: 10000 });
}

function renderHours(hours) {
  $('hoursRows').innerHTML = DAYS.map(([k, label]) => {
    const d = hours[k] || { closed: true, open: '', close: '' };
    return `<div class="hours-row" data-day="${k}">
      <span class="day">${label}</span>
      <label class="closed-toggle"><input type="checkbox" ${d.closed ? 'checked' : ''} onchange="this.closest('.hours-row').classList.toggle('is-closed', this.checked)"> Fechado</label>
      <input type="time" value="${escapeHtml(d.open || '11:00')}"><span class="mut">às</span><input type="time" value="${escapeHtml(d.close || '22:00')}">
    </div>`;
  }).join('');
  document.querySelectorAll('.hours-row').forEach(row => row.classList.toggle('is-closed', row.querySelector('input[type=checkbox]').checked));
}

function readHours() {
  const out = {};
  document.querySelectorAll('.hours-row').forEach(row => {
    const [open, close] = row.querySelectorAll('input[type=time]');
    out[row.dataset.day] = { closed: row.querySelector('input[type=checkbox]').checked, open: open.value, close: close.value };
  });
  return out;
}

function copyFirstDay() {
  const rows = [...document.querySelectorAll('.hours-row')];
  const [c, o, cl] = [rows[0].querySelector('input[type=checkbox]').checked, ...[...rows[0].querySelectorAll('input[type=time]')].map(i => i.value)];
  rows.slice(1).forEach(row => {
    row.querySelector('input[type=checkbox]').checked = c;
    const t = row.querySelectorAll('input[type=time]'); t[0].value = o; t[1].value = cl;
    row.classList.toggle('is-closed', c);
  });
}

function addMenuItem(item = {}) {
  const row = document.createElement('div');
  row.className = 'menu-row';
  row.innerHTML = `
    <input class="m-section" list="sectionList" placeholder="Seção (ex.: Pizzas)" value="${escapeHtml(item.section || '')}" onchange="refreshSections()">
    <input class="m-name" placeholder="Nome do prato" value="${escapeHtml(item.name || '')}">
    <input class="m-price" inputmode="decimal" placeholder="Preço (R$)" value="${item.price != null ? String(item.price).replace('.', ',') : ''}">
    <input class="m-desc" placeholder="Descrição (opcional)" value="${escapeHtml(item.description || '')}">
    <button type="button" class="icon-btn" title="Remover item" onclick="this.parentElement.remove()">✕</button>`;
  $('menuRows').appendChild(row);
  refreshSections();
}

function refreshSections() {
  const s = new Set([...document.querySelectorAll('.m-section')].map(i => i.value.trim()).filter(Boolean));
  $('sectionList').innerHTML = [...s].map(x => `<option value="${escapeHtml(x)}">`).join('');
}

function readMenu() {
  return [...document.querySelectorAll('.menu-row')].map(r => ({
    section: r.querySelector('.m-section').value, name: r.querySelector('.m-name').value,
    price: r.querySelector('.m-price').value, description: r.querySelector('.m-desc').value
  })).filter(i => i.name.trim());
}

function renderPhotos() {
  $('photoGrid').innerHTML = editing.photos.map((p, i) => `
    <div class="photo">
      <img src="${escapeHtml(p)}" alt="">
      ${i === 0 ? '<span class="cover-tag">Capa</span>' : `<button type="button" class="ph-btn left" title="Usar como capa" onclick="makeCover(${i})">★ Capa</button>`}
      <button type="button" class="ph-btn right" title="Remover" onclick="removePhoto(${i})">✕</button>
    </div>`).join('');
}
function makeCover(i) { editing.photos.unshift(editing.photos.splice(i, 1)[0]); renderPhotos(); }
function removePhoto(i) { editing.photos.splice(i, 1); renderPhotos(); }

function resizeImage(file, max = 1280) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => reject(new Error(`Não foi possível ler a imagem ${file.name}.`));
    img.src = URL.createObjectURL(file);
  });
}

async function uploadPhotos(input) {
  const files = [...input.files];
  input.value = '';
  for (const f of files) {
    if (editing.photos.length >= 12) { showFormError('Limite de 12 fotos atingido.'); break; }
    try {
      const dataUrl = await resizeImage(f);
      const { url } = await apiFetch('/api/uploads', { method: 'POST', body: JSON.stringify({ dataUrl }) });
      editing.photos.push(url);
      renderPhotos();
    } catch (e) { showFormError(e.message); }
  }
}

function showFormError(msg) { $('rError').textContent = msg; $('rError').classList.remove('hide'); $('rError').scrollIntoView({ behavior: 'smooth', block: 'center' }); }

async function saveRestaurant(e) {
  e.preventDefault();
  $('rError').classList.add('hide');
  if (!$('rName').value.trim()) return showFormError('Informe o nome do restaurante.');
  if (!rMarker) return showFormError('Marque a localização do restaurante no mapa (seção 3).');
  const pos = rMarker.getLatLng();
  const body = {
    osmRef: editing.osmRef,
    name: $('rName').value, category: $('rCategory').value, priceRange: $('rPrice').value, cuisine: $('rCuisine').value,
    description: $('rDescription').value, website: $('rWebsite').value, phone: $('rPhone').value, whatsapp: $('rWhatsapp').value,
    instagram: $('rInstagram').value, deliveryUrl: $('rDelivery').value, menuUrl: $('rMenuUrl').value,
    address: $('rAddress').value, lat: pos.lat, lng: pos.lng,
    hours: readHours(), menu: readMenu(), photos: editing.photos
  };
  const btn = $('rSave');
  btn.disabled = true; btn.textContent = 'Salvando...';
  try {
    const url = editing.id ? `/api/my/restaurants/${editing.id}` : '/api/my/restaurants';
    const { restaurant } = await apiFetch(url, { method: editing.id ? 'PUT' : 'POST', body: JSON.stringify(body) });
    cancelEdit();
    await loadMyRestaurants();
    await loadRestaurants({ keepPage: true, silent: true });
    setStatus(`"${restaurant.name}" salvo! As informações já aparecem na busca.`, 'success');
    $('myList').insertAdjacentHTML('afterbegin', `<div class="saved-msg">✅ "${escapeHtml(restaurant.name)}" salvo com sucesso. As informações já aparecem na lista de restaurantes.</div>`);
  } catch (err) { showFormError(err.message); }
  finally { btn.disabled = false; btn.textContent = 'Salvar restaurante'; }
}

(async function start() {
  try { me = (await apiFetch('/api/auth/me')).user; } catch { me = null; }
  renderAccount();
  loadRestaurants();
})();