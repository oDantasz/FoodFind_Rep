'use strict';
// FoodFind 4.0: front-end em JavaScript puro.
// Sem atributos onclick: as ações usam data-action/data-form (compatível com a CSP do servidor).

const APP_VERSION = '4.0.0';
const TZ = 'America/Sao_Paulo';
const PAGE_SIZE = 10;
const DEFAULT_LOC = { lat: -23.5613, lng: -46.6565 };
const DAYS = [['seg', 'Segunda'], ['ter', 'Terça'], ['qua', 'Quarta'], ['qui', 'Quinta'], ['sex', 'Sexta'], ['sab', 'Sábado'], ['dom', 'Domingo']];
const JSQR = { src: 'https://unpkg.com/jsqr@1.4.0/dist/jsQR.js', integrity: 'sha384-b5Ya4Bq3qCyz39m2ISh+4DxjAIljdeFwK/BsXLuj9gugaNwAcj/ia15fxNZL9Nlx' };
const $ = id => document.getElementById(id);

let me = null;
let map = null, markerLayer = null, userMarker = null, addressMarker = null;
let userLocation = null, searchCenter = null, areaRadius = null, programmaticMove = false;
let currentRestaurants = [], visibleCount = PAGE_SIZE, searchSeq = 0, lastWarning = '';
let currentDetail = null, reviewPage = 1;
let myRestaurants = [], myClaims = [], editing = null, rMap = null, rMarker = null;
let myCampaigns = [], editingCampaign = null;
let pendingAfterLogin = null;
let firstRoute = true;

// ----------------------------------------------------------------------------
// Utilidades
// ----------------------------------------------------------------------------
// Ícones SVG do sprite em index.html (sem emojis como ícone).
function icon(name, cls = '') { return `<svg class="i${cls ? ` ${cls}` : ''}" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`; }
function escapeHtml(s = '') {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function money(v) { return v == null ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function fmtDateTime(iso) {
  return iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
}
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: TZ }) : ''; }
function fmtRating(r) { return r == null ? '' : Number(r).toFixed(1).replace('.', ','); }
function todayKeySP() {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(new Date());
  return { Sun: 'dom', Mon: 'seg', Tue: 'ter', Wed: 'qua', Thu: 'qui', Fri: 'sex', Sat: 'sab' }[wd];
}
function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }
function stars(n) { const k = Math.round(n || 0); return '★'.repeat(k) + '☆'.repeat(5 - k); }
function store(key, value) {
  try { if (value === undefined) return localStorage.getItem(key); if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { return null; }
  return null;
}
function session(key, value) {
  try { if (value === undefined) return sessionStorage.getItem(key); if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value); } catch { return null; }
  return null;
}

// "2026-11-20T19:30" no horário de São Paulo (para <input type="datetime-local">).
function spInput(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

async function apiFetch(url, options = {}) {
  const opts = { credentials: 'same-origin', ...options, headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } };
  let res;
  try { res = await fetch(url, opts); }
  catch { throw Object.assign(new Error('Sem conexão com o servidor. Verifique sua internet e tente novamente.'), { status: 0, code: 'offline' }); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || 'Erro na requisição.'), { status: res.status, code: data.code });
  return data;
}

function setStatus(text = '', kind = '') {
  const el = $('status');
  el.textContent = text;
  el.className = `status ${kind}`;
}

function stateBox(kind, message, action = '') {
  const glyph = { loading: icon('refresh', 'spin'), error: icon('alert'), empty: icon('utensils') }[kind] || '';
  return `<div class="state ${kind}" role="${kind === 'error' ? 'alert' : 'status'}">${glyph}<p>${escapeHtml(message)}</p>${action}</div>`;
}

// ----------------------------------------------------------------------------
// Modais acessíveis (foco preso, ESC fecha, foco volta para quem abriu)
// ----------------------------------------------------------------------------
const modalStack = [];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function openModal(id, focusSelector) {
  const el = $(id);
  if (!modalStack.some(m => m.id === id)) modalStack.push({ id, opener: document.activeElement });
  el.classList.remove('hide');
  document.body.classList.add('modal-open');
  const target = (focusSelector && el.querySelector(focusSelector)) || [...el.querySelectorAll(FOCUSABLE)].find(x => x.offsetParent !== null);
  if (target && !el.contains(document.activeElement)) target.focus();
}

function closeModal(id) {
  const idx = modalStack.findIndex(m => m.id === id);
  if (idx === -1) return;
  const [{ opener }] = modalStack.splice(idx, 1);
  $(id).classList.add('hide');
  if (id === 'scanModal') stopScan();
  if (id === 'authModal') {
    pendingAfterLogin = null;
    // Ao fechar, a senha volta a ficar oculta.
    document.querySelectorAll('#authModal .pw-toggle[aria-pressed=true]').forEach(togglePassword);
    updatePwMeter();
  }
  if (id === 'confirmModal' && confirmState) { const st = confirmState; confirmState = null; st.resolve(null); }
  if (!modalStack.length) document.body.classList.remove('modal-open');
  if (opener && document.contains(opener) && opener.focus) opener.focus();
}

function topModal() { return modalStack.length ? $(modalStack[modalStack.length - 1].id) : null; }

document.addEventListener('keydown', e => {
  const modal = topModal();
  if (modal && e.key === 'Escape') { e.preventDefault(); closeModal(modal.id); return; }
  if (modal && e.key === 'Tab') {
    const items = [...modal.querySelectorAll(FOCUSABLE)].filter(x => x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!modal.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  }
  // Cards (links) também respondem à barra de espaço, como botões.
  if (e.key === ' ' && e.target.matches && e.target.matches('a.item, [role=button]')) { e.preventDefault(); e.target.click(); }
});

document.addEventListener('mousedown', e => {
  if (e.target.matches && e.target.matches('.modal-overlay')) e.target.dataset.downOnOverlay = '1';
});
document.addEventListener('click', e => {
  if (e.target.matches && e.target.matches('.modal-overlay') && e.target.dataset.downOnOverlay === '1') closeModal(e.target.id);
  if (e.target.dataset) delete e.target.dataset.downOnOverlay;
});

// Caixa de confirmação. onConfirm (opcional) roda antes de fechar; se der erro, a mensagem
// aparece na própria caixa e ela continua aberta. Devolve os valores digitados ou null (cancelado).
let confirmState = null;
function confirmDialog({ title, text, okLabel = 'Confirmar', danger = true, extra = '', onConfirm = null }) {
  if (confirmState) { const st = confirmState; confirmState = null; st.resolve(null); }
  return new Promise(resolve => {
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text;
    $('confirmExtra').innerHTML = extra;
    $('confirmError').classList.add('hide');
    const ok = $('confirmOk');
    ok.textContent = okLabel;
    ok.disabled = false;
    ok.className = danger ? 'danger' : 'primary';
    confirmState = { resolve, onConfirm };
    openModal('confirmModal', extra ? 'input, textarea' : '#confirmOk');
  });
}

function confirmError(msg) { $('confirmError').textContent = msg; $('confirmError').classList.remove('hide'); }

// ----------------------------------------------------------------------------
// Conta, login e cadastro
// ----------------------------------------------------------------------------
function renderAccount() {
  const area = $('accountArea');
  const qr = document.querySelector('.qr-btn');
  qr.classList.toggle('hide', Boolean(me && me.role !== 'cliente'));
  if (!me) {
    area.innerHTML = `<button type="button" class="account-btn login-btn" data-action="login">Entrar</button>
      <button type="button" class="account-btn primary-btn" data-action="register">Criar conta ${icon('arrow')}</button>`;
    return;
  }
  const links = me.role === 'restaurante'
    ? `<a href="#/painel"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-store"></use></svg> Meu restaurante</a><a href="#/campanhas"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-ticket"></use></svg> Campanhas e vouchers</a>`
    : `<a href="#/beneficios"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-gift"></use></svg> Meus benefícios</a>`;
  area.innerHTML = `<details class="user-menu">
      <summary class="account-btn"><span class="user">Olá, ${escapeHtml(me.name.split(' ')[0])}</span> <span aria-hidden="true">▾</span></summary>
      <div class="menu-panel">
        ${links}
        ${me.isAdmin ? '<a href="#/admin"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-shield"></use></svg> Administração</a>' : ''}
        <a href="#/conta"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-user"></use></svg> Minha conta</a>
        <button type="button" data-action="logout"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-logout"></use></svg> Sair</button>
      </div>
    </details>`;
}

function openAuth(mode = 'login', { role, notice } = {}) {
  clearAuthError();
  switchTab(mode);
  if (role) document.querySelector(`input[name="regRole"][value="${role}"]`).checked = true;
  $('authNotice').textContent = notice || '';
  $('authNotice').classList.toggle('hide', !notice);
  openModal('authModal', mode === 'login' ? '#loginEmail' : '#regName');
}
function clearAuthError() { $('modalError').textContent = ''; $('modalError').classList.add('hide'); }
function showAuthError(msg) { $('modalError').textContent = msg; $('modalError').classList.remove('hide'); }

function switchTab(mode) {
  clearAuthError();
  const login = mode === 'login';
  $('tabLogin').classList.toggle('active', login);
  $('tabRegister').classList.toggle('active', !login);
  $('tabLogin').setAttribute('aria-selected', String(login));
  $('tabRegister').setAttribute('aria-selected', String(!login));
  $('formLogin').classList.toggle('hide', !login);
  $('formRegister').classList.toggle('hide', login);
  // Indicador deslizante das abas e entrada suave do formulário.
  document.querySelector('#authModal .modal-tabs').dataset.mode = login ? 'login' : 'register';
  document.querySelector('#authModal .auth-card').dataset.mode = login ? 'login' : 'register';
}

// Mostrar/ocultar senha. O valor nunca sai do campo.
function togglePassword(btn) {
  const input = $(btn.dataset.target);
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.setAttribute('aria-pressed', String(show));
  btn.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
  btn.innerHTML = icon(show ? 'eye-off' : 'eye');
}

// Medidor de força da senha no cadastro: só orienta, quem valida é o servidor (mínimo de 8).
function updatePwMeter() {
  const v = $('regPassword').value;
  let score = 0;
  if (v.length >= 8) score++;
  if (v.length >= 12) score++;
  if (/[a-z]/.test(v) && /[A-Z]/.test(v)) score++;
  if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) score++;
  const levels = [['', 'Use pelo menos 8 caracteres.'], ['fraca', 'Senha fraca: aumente ou misture letras e números.'], ['ok', 'Senha razoável.'], ['boa', 'Senha boa.'], ['forte', 'Senha forte.']];
  const [cls, text] = v.length < 8 ? levels[0] : levels[Math.max(1, score)];
  const meter = $('pwMeter');
  meter.dataset.level = cls;
  meter.querySelector('small').textContent = text;
}

async function afterAuth(message) {
  const pending = pendingAfterLogin;
  pendingAfterLogin = null;
  closeModal('authModal');
  renderAccount();
  setStatus(message, 'success');
  if (session('ff_pending_redeem')) { route(); return processPendingRedeem(); }
  if (pending) return pending();
  route();
}

async function handleRegister() {
  const btn = $('formRegister').querySelector('button[type=submit]');
  if (!$('regTerms').checked) return showAuthError('Para criar a conta, aceite os Termos de Uso e a Política de Privacidade.');
  btn.disabled = true; btn.classList.add('is-loading');
  try {
    const data = await apiFetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: $('regName').value.trim(), email: $('regEmail').value.trim(), password: $('regPassword').value,
        role: document.querySelector('input[name="regRole"]:checked').value, acceptTerms: true
      })
    });
    me = data.user;
    $('formRegister').reset(); $('formLogin').reset();
    await afterAuth(`Conta criada com sucesso! Olá, ${me.name}.`);
    if (me.role === 'restaurante' && !location.hash.startsWith('#/painel')) location.hash = '#/painel';
  } catch (err) { showAuthError(err.message); }
  finally { btn.disabled = false; btn.classList.remove('is-loading'); }
}

async function handleLogin() {
  const btn = $('formLogin').querySelector('button[type=submit]');
  btn.disabled = true; btn.classList.add('is-loading');
  try {
    const data = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: $('loginEmail').value.trim(), password: $('loginPassword').value }) });
    me = data.user;
    $('formLogin').reset();
    await afterAuth(`Bem-vindo(a) de volta, ${me.name}!`);
  } catch (err) { showAuthError(err.message); }
  finally { btn.disabled = false; btn.classList.remove('is-loading'); }
}

async function logout() {
  await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  me = null;
  renderAccount();
  setStatus('Você saiu da conta.');
  if (location.hash && !location.hash.startsWith('#/restaurante') && location.hash !== '#/') location.hash = '#/';
  else route();
}

// Exige login (e opcionalmente um tipo de conta) para abrir uma tela.
function guard(check, onOk, message) {
  if (!me) {
    showView('home');
    pendingAfterLogin = () => route();
    openAuth('login', { notice: message || 'Entre na sua conta para acessar esta página.' });
    return;
  }
  if (!check(me)) {
    setStatus('Esta página não está disponível para o seu tipo de conta.', 'error');
    location.hash = '#/';
    return;
  }
  onOk();
}

// ----------------------------------------------------------------------------
// Rotas (hash): #/restaurante/ff-12, #/painel, #/campanhas, #/beneficios, #/conta, #/admin
// ----------------------------------------------------------------------------
const VIEWS = ['home', 'detail', 'panel', 'campaigns', 'benefits', 'account', 'admin', 'privacy', 'terms'];
const TITLES = { home: 'FoodFind', panel: 'Meus restaurantes', campaigns: 'Campanhas e vouchers', benefits: 'Meus benefícios', account: 'Minha conta', admin: 'Administração', privacy: 'Política de Privacidade', terms: 'Termos de Uso' };

function showView(view) {
  for (const v of VIEWS) $(`view-${v}`).classList.toggle('hide', v !== view);
  document.title = TITLES[view] ? `${TITLES[view]} · FoodFind` : document.title;
  if (view === 'home' && map) setTimeout(() => map.invalidateSize(), 60);
  if (!firstRoute) {
    window.scrollTo(0, 0);
    const h = $(`view-${view}`).querySelector('h1');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }
}

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const isOwner = u => u.role === 'restaurante';
  const isClient = u => u.role === 'cliente';
  switch (parts[0]) {
    case 'restaurante': if (parts[1]) openRestaurant(parts[1]); else location.hash = '#/'; break;
    case 'painel': guard(isOwner, openPanel, 'Entre com uma conta de restaurante para acessar o painel.'); break;
    case 'campanhas': guard(isOwner, openCampaigns, 'Entre com uma conta de restaurante para gerenciar campanhas.'); break;
    case 'beneficios': guard(isClient, openBenefits, 'Entre como cliente para ver seus benefícios.'); break;
    case 'conta': guard(() => true, openAccount); break;
    case 'admin': guard(u => u.isAdmin, openAdmin, 'Entre com a conta de administrador.'); break;
    case 'privacidade': showView('privacy'); break;
    case 'termos': showView('terms'); break;
    default: showView('home');
  }
  firstRoute = false;
}

window.addEventListener('hashchange', route);

// ----------------------------------------------------------------------------
// Mapa
// ----------------------------------------------------------------------------
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
// O CARTO saiu da lista: hoje ele devolve uma imagem "API KEY REQUIRED" com status 200,
// o que o Leaflet não reconhece como erro (o mapa ficava cinza em vez de passar para o próximo).
const TILE_PROVIDERS = [
  { name: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', options: { maxZoom: 19, attribution: OSM_ATTR } },
  { name: 'Esri', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', options: { maxZoom: 19, attribution: 'Mapa &copy; Esri' } },
  { name: 'Servidor FoodFind', url: '/tiles/{z}/{x}/{y}', options: { maxZoom: 19, attribution: OSM_ATTR } }
];

function savedProvider() {
  const i = Number(store('ff_tile_provider_v2'));
  return Number.isInteger(i) && i >= 0 && i < TILE_PROVIDERS.length ? i : 0;
}

function showMapAlert(m, show) {
  if (m._ffAlert) { m.removeControl(m._ffAlert); m._ffAlert = null; }
  if (!show) return;
  const ctrl = L.control({ position: 'topright' });
  ctrl.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-alert');
    div.setAttribute('role', 'alert');
    div.innerHTML = `<b>O desenho do mapa não carregou.</b>
      <span>Nenhum dos ${TILE_PROVIDERS.length} servidores de mapa respondeu. A rede, o antivírus ou um bloqueador de anúncios pode estar bloqueando. A lista de restaurantes continua funcionando.</span>
      <div><button type="button" data-act="retry">Tentar de novo</button>${me && me.isAdmin ? '<a href="/api/map-check" target="_blank" rel="noopener">Ver diagnóstico</a>' : ''}</div>`;
    L.DomEvent.disableClickPropagation(div);
    div.querySelector('[data-act=retry]').addEventListener('click', () => {
      store('ff_tile_provider_v2', null);
      showMapAlert(m, false);
      if (m._ffLayer) m.removeLayer(m._ffLayer);
      addBaseLayer(m, 0, 0);
    });
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
  const next = () => {
    if (done || loaded) return;
    done = true;
    m.removeLayer(layer);
    if (tried + 1 >= TILE_PROVIDERS.length) return showMapAlert(m, true);
    addBaseLayer(m, (i + 1) % TILE_PROVIDERS.length, tried + 1);
  };
  layer.on('tileload', () => { if (!loaded++) store('ff_tile_provider_v2', String(i)); });
  layer.on('tileerror', () => { if (++errors >= 3) next(); });
  setTimeout(next, 8000);
  return layer;
}

function initMap() {
  if (!window.L) {
    $('map').innerHTML = stateBox('error', 'O mapa não pôde ser carregado (a biblioteca de mapas foi bloqueada pela rede). A lista de restaurantes continua funcionando.');
    return;
  }
  map = L.map('map', { maxZoom: 19 }).setView([DEFAULT_LOC.lat, DEFAULT_LOC.lng], 14);
  addBaseLayer(map);
  markerLayer = L.markerClusterGroup ? L.markerClusterGroup({ maxClusterRadius: 45, showCoverageOnHover: false }) : L.layerGroup();
  markerLayer.addTo(map);
  map.on('moveend', () => {
    if (programmaticMove) { programmaticMove = false; return; }
    $('searchAreaBtn').classList.remove('hide');
  });
}

function moveMap(fn) { if (!map) return; programmaticMove = true; fn(); setTimeout(() => { programmaticMove = false; }, 600); }

function pinIcon(r) {
  const label = r.rating != null ? fmtRating(r.rating) : (r.registered ? '★' : '•');
  return L.divIcon({
    className: `ff-pin${r.registered ? ' registered' : ''}`,
    html: `<span><i>${escapeHtml(label)}</i></span>`,
    iconSize: [34, 34], iconAnchor: [17, 34], popupAnchor: [0, -30]
  });
}

function popupHtml(r) {
  const rating = r.rating != null ? `<span class="rating"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-star"></use></svg> ${fmtRating(r.rating)}</span> <span class="mut">(${plural(r.reviewCount, 'avaliação', 'avaliações')})</span>` : '<span class="mut">Sem avaliações</span>';
  const open = r.openNow === true ? '<span class="open-tag on">Aberto agora</span>' : r.openNow === false ? '<span class="open-tag off">Fechado agora</span>' : '';
  return `<div class="popup"><b>${escapeHtml(r.name)}</b><br><span class="mut">${escapeHtml(r.category)}${r.priceRange ? ` · ${escapeHtml(r.priceRange)}` : ''}</span><br>${rating}<br>
    <span class="mut"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-pin"></use></svg> ${escapeHtml(r.distance)}</span> ${open}<br><a class="popup-btn" href="#/restaurante/${encodeURIComponent(r.id)}">Ver perfil</a></div>`;
}

// Ao passar o mouse (ou o foco do teclado) num restaurante da lista, o pin dele se destaca no mapa.
let markerById = new Map(), litMarker = null;
function highlightMarker(id) {
  if (litMarker && litMarker._icon) litMarker._icon.classList.remove('lit');
  litMarker = null;
  const mk = id && markerById.get(String(id));
  if (!mk) return;
  const visible = markerLayer.getVisibleParent ? markerLayer.getVisibleParent(mk) : mk;
  const target = visible || mk;
  if (target._icon) { target._icon.classList.add('lit'); litMarker = target; }
}

function renderMarkers(list) {
  if (!map) return;
  markerLayer.clearLayers();
  markerById = new Map();
  const markers = list.map(r => {
    const mk = L.marker([r.lat, r.lng], { icon: pinIcon(r), title: `${r.name}${r.rating != null ? `, nota ${fmtRating(r.rating)}` : ''}`, alt: r.name, riseOnHover: true })
      .bindPopup(popupHtml(r));
    markerById.set(String(r.id), mk);
    return mk;
  });
  if (markerLayer.addLayers) markerLayer.addLayers(markers); else markers.forEach(mk => markerLayer.addLayer(mk));
}

// ----------------------------------------------------------------------------
// Localização (com consentimento) e busca por endereço
// ----------------------------------------------------------------------------
function geoConsent() { return store('ff_geo_consent'); }

function askGeoConsent() {
  $('geoBanner').classList.remove('hide');
  const btn = $('geoBanner').querySelector('[data-action=geo-allow]');
  btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
  btn.focus({ preventScroll: true });
}

function useMyLocation() {
  if (geoConsent() !== 'sim') return askGeoConsent();
  if (!navigator.geolocation) { setStatus('Seu navegador não oferece geolocalização. Pesquise por endereço ou bairro.', 'error'); $('addr').focus(); return; }
  setStatus('Solicitando sua localização...');
  navigator.geolocation.getCurrentPosition(pos => {
    userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    searchCenter = userLocation; areaRadius = null;
    if (map) {
      moveMap(() => map.setView([userLocation.lat, userLocation.lng], 15));
      if (userMarker) map.removeLayer(userMarker);
      userMarker = L.circleMarker([userLocation.lat, userLocation.lng], { radius: 9, color: '#1d4ed8', fillOpacity: 0.6 }).addTo(map).bindPopup('Você está aqui');
    }
    setStatus('Localização encontrada. Buscando restaurantes próximos...', 'success');
    loadRestaurants();
  }, err => {
    const msg = err.code === 1
      ? 'Permissão de localização negada. Pesquise por endereço ou bairro no campo abaixo.'
      : 'Não foi possível obter sua localização. Pesquise por endereço ou bairro no campo abaixo.';
    setStatus(msg, 'error');
    if (!currentRestaurants.length) loadRestaurants({ silent: true });
    if (!$('view-home').classList.contains('hide')) $('addr').focus();
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}

async function searchAddress() {
  const q = $('addr').value.trim();
  const box = $('addrResults');
  if (q.length < 3) { box.innerHTML = '<span class="mut">Digite pelo menos 3 letras do endereço ou bairro.</span>'; box.classList.remove('hide'); return; }
  box.innerHTML = '<span class="mut">Buscando endereço...</span>';
  box.classList.remove('hide');
  try {
    const { results } = await apiFetch(`/api/geocode?q=${encodeURIComponent(q)}`);
    if (!results.length) { box.innerHTML = '<span class="mut">Endereço não encontrado. Tente incluir o bairro e a cidade.</span>'; return; }
    box.innerHTML = results.map((r, i) => `<button type="button" data-action="pick-address" data-i="${i}"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-pin"></use></svg> ${escapeHtml(r.label)}</button>`).join('');
    box._results = results;
    box.querySelector('button').focus();
  } catch (e) { box.innerHTML = `<span class="error-text">${escapeHtml(e.message)}</span>`; }
}

function pickAddress(i) {
  const r = $('addrResults')._results[i];
  $('addrResults').classList.add('hide');
  searchCenter = { lat: r.lat, lng: r.lng }; areaRadius = null;
  if (map) {
    moveMap(() => map.setView([r.lat, r.lng], 15));
    if (addressMarker) map.removeLayer(addressMarker);
    addressMarker = L.circleMarker([r.lat, r.lng], { radius: 8, color: '#7c3aed', fillOpacity: 0.5 }).addTo(map).bindPopup(`Endereço pesquisado: ${escapeHtml(r.label)}`);
  }
  setStatus(`Buscando restaurantes perto de: ${r.label}`);
  loadRestaurants();
}

// ----------------------------------------------------------------------------
// Busca, filtros e lista
// ----------------------------------------------------------------------------
function filterParams() {
  const f = $('filtersForm');
  const params = new URLSearchParams();
  const center = searchCenter || userLocation || DEFAULT_LOC;
  params.set('lat', center.lat.toFixed(6));
  params.set('lng', center.lng.toFixed(6));
  params.set('q', $('q').value.trim());
  for (const name of ['category', 'price', 'minRating', 'sort']) if (f.elements[name].value) params.set(name, f.elements[name].value);
  params.set('radius', areaRadius || f.elements.radius.value);
  if (f.elements.open.checked) params.set('open', '1');
  return params;
}

async function loadRestaurants({ keepPage = false, silent = false } = {}) {
  const seq = ++searchSeq;
  if (!silent) {
    setStatus('Consultando restaurantes próximos...');
    $('list').innerHTML = `<p class="sr-only" role="status">Buscando restaurantes...</p><ul class="cards skeleton" aria-hidden="true">${'<li><div class="item"><div class="food-icon"></div><div><span class="sk sk-title"></span><span class="sk"></span><span class="sk sk-short"></span></div></div></li>'.repeat(5)}</ul>`;
  }
  $('searchAreaBtn').classList.add('hide');
  loadDeals();
  try {
    const data = await apiFetch(`/api/restaurants?${filterParams()}`);
    if (seq !== searchSeq) return;
    currentRestaurants = data.restaurants || [];
    lastWarning = data.warning || '';
    if (!keepPage) visibleCount = PAGE_SIZE;
    renderList();
    if (map && currentRestaurants.length && !keepPage && !userLocation && !searchCenter) {
      moveMap(() => map.fitBounds(L.latLngBounds(currentRestaurants.slice(0, PAGE_SIZE).map(r => [r.lat, r.lng])).pad(0.15)));
    }
    if (map) setTimeout(() => map.invalidateSize(), 200);
    const cadastrados = currentRestaurants.filter(r => r.registered).length;
    if (data.warning) setStatus(data.warning, 'error');
    else if (!silent) setStatus(`${plural(data.total, 'estabelecimento encontrado', 'estabelecimentos encontrados')}${cadastrados ? ` · ${cadastrados} cadastrado(s) no FoodFind` : ''}.`, 'success');
  } catch (e) {
    if (seq !== searchSeq) return;
    $('list').innerHTML = stateBox('error', `Não foi possível carregar os restaurantes. ${e.message}`, '<button type="button" class="soft small" data-action="retry-search">Tentar de novo</button>');
    $('count').textContent = '';
    setStatus(e.message, 'error');
  }
}

function renderList() {
  const total = currentRestaurants.length;
  const shown = currentRestaurants.slice(0, visibleCount);
  $('count').textContent = `(${total})`;
  if (!total && lastWarning) {
    $('list').innerHTML = stateBox('error', `${lastWarning} Tente de novo em alguns instantes.`, '<button type="button" class="soft small" data-action="retry-search">Tentar de novo</button>');
  } else if (!total) {
    $('list').innerHTML = stateBox('empty', 'Nenhum estabelecimento encontrado com esses filtros. Tente outra busca, aumente a distância ou limpe os filtros.', '<button type="button" class="soft small" data-action="clear-filters">Limpar filtros</button>');
  } else {
    const remaining = total - shown.length;
    $('list').innerHTML = `<ul class="cards">${shown.map(r => `<li>${card(r)}</li>`).join('')}</ul>` + (remaining > 0
      ? `<button type="button" class="more-btn" data-action="more"><span>Ver mais</span>
           <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
           <small>Mostrando ${shown.length} de ${total}</small></button>`
      : (total > PAGE_SIZE ? `<p class="list-end">Você viu todos os ${total} restaurantes.</p>` : ''));
  }
  renderMarkers(currentRestaurants);
}

function categoryEmoji(c) {
  const name = { 'Café': 'coffee', 'Fast-food': 'burger', 'Lanchonete': 'burger', 'Pizzaria': 'pizza', 'Bar': 'beer', 'Padaria': 'bread', 'Sorveteria': 'icecream', 'Doceria': 'cake' }[c] || 'utensils';
  return icon(name);
}

// Chips de categoria (inspirados no "Cuisine Selector Chips" do 21st.dev): seleção múltipla.
// O valor escolhido vai para o campo oculto "category" do formulário de filtros, separado por vírgula.
const CHIP_CATEGORIES = ['Restaurante', 'Pizzaria', 'Lanchonete', 'Fast-food', 'Café', 'Bar', 'Padaria', 'Sorveteria', 'Doceria', 'Outro'];
function renderChips() {
  const chosen = new Set($('fCategory').value.split(',').filter(Boolean));
  $('catChips').innerHTML = CHIP_CATEGORIES.map(c => `<button type="button" class="chip" data-action="cat-toggle" data-cat="${escapeHtml(c)}" aria-pressed="${chosen.has(c)}">${categoryEmoji(c)}<span>${escapeHtml(c)}</span><span class="chip-check" aria-hidden="true">${icon('check')}</span></button>`).join('');
  document.querySelector('.chip-all').setAttribute('aria-pressed', String(!chosen.size));
}
function setChip(btn, on) {
  btn.setAttribute('aria-pressed', String(on));
  const chosen = [...document.querySelectorAll('#catChips .chip[aria-pressed=true]')].map(b => b.dataset.cat);
  $('fCategory').value = chosen.join(',');
  document.querySelector('.chip-all').setAttribute('aria-pressed', String(!chosen.length));
  loadRestaurants();
}
function clearChips() {
  $('fCategory').value = '';
  document.querySelectorAll('#catChips .chip').forEach(b => b.setAttribute('aria-pressed', 'false'));
  document.querySelector('.chip-all').setAttribute('aria-pressed', 'true');
}

// Brilho que acompanha o cursor (inspirado no "Spotlight Card" do 21st.dev). Só em mouse/caneta.
const finePointer = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
if (finePointer) {
  document.addEventListener('pointermove', e => {
    const el = e.target.closest && e.target.closest('.spot');
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, { passive: true });
}

function card(r) {
  const rating = r.rating != null
    ? `<svg class="i" aria-hidden="true" focusable="false"><use href="#i-star"></use></svg> ${fmtRating(r.rating)} <span class="mut">(${plural(r.reviewCount, 'avaliação', 'avaliações')})</span>`
    : '<span class="no-rating">Sem avaliações</span>';
  const thumb = r.image ? `<img class="food-icon food-img" src="${escapeHtml(r.image)}" alt="" loading="lazy">` : `<div class="food-icon" aria-hidden="true">${categoryEmoji(r.category)}</div>`;
  const open = r.openNow === true ? '<span class="open-tag on">Aberto agora</span>' : r.openNow === false ? '<span class="open-tag off">Fechado agora</span>' : '';
  return `<a class="item spot${r.registered ? ' registered' : ''}" href="#/restaurante/${encodeURIComponent(r.id)}" data-id="${escapeHtml(r.id)}">${thumb}<div>
    <h3>${escapeHtml(r.name)}</h3>
    <div class="mut">${escapeHtml(r.category)}${r.priceRange ? ` · ${escapeHtml(r.priceRange)}` : ''}${r.registered ? ' · <span class="verified"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-check"></use></svg> Cadastrado</span>' : ''}</div>
    <div class="rating">${rating}</div>
    <div class="mut"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-pin"></use></svg> ${escapeHtml(r.distance)} ${open}</div>
  </div></a>`;
}

// ---- Descontos por perto (vitrine em forma de comanda) ----
let dealsSeq = 0;
async function loadDeals() {
  const seq = ++dealsSeq;
  const center = searchCenter || userLocation || DEFAULT_LOC;
  const radius = areaRadius || $('filtersForm').elements.radius.value;
  try {
    const { campaigns } = await apiFetch(`/api/campaigns/nearby?lat=${center.lat.toFixed(6)}&lng=${center.lng.toFixed(6)}&radius=${radius}`);
    if (seq !== dealsSeq) return;
    const box = $('deals');
    if (!campaigns.length) { box.classList.add('hide'); return; }
    $('dealsList').innerHTML = campaigns.slice(0, 4).map(c => `<li><a class="deal spot" href="#/restaurante/${encodeURIComponent(c.restaurantId)}">
        <span class="deal-value">${escapeHtml(c.discountLabel.replace(' de desconto', ''))}<small>de desconto</small></span>
        <span class="deal-body"><b>${escapeHtml(c.restaurantName)}</b><span>${escapeHtml(c.title)}</span>
        <small>${icon('pin')} ${escapeHtml(c.distance)} <span aria-hidden="true">·</span> até ${escapeHtml(fmtDate(c.endsAt))}</small></span></a></li>`).join('');
    box.classList.remove('hide');
  } catch { if (seq === dealsSeq) $('deals').classList.add('hide'); }
}

function setViewMode(mode) {
  $('homeGrid').dataset.mode = mode;
  document.querySelectorAll('.view-toggle [data-action=view-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  document.querySelector('.view-toggle').dataset.mode = mode;
  if (mode === 'map' && map) setTimeout(() => map.invalidateSize(), 60);
}

function clearFilters() {
  $('filtersForm').reset();
  clearChips();
  $('q').value = '';
  areaRadius = null;
  loadRestaurants();
}

function searchThisArea() {
  if (!map) return;
  const c = map.getCenter();
  const corner = map.getBounds().getNorthEast();
  searchCenter = { lat: c.lat, lng: c.lng };
  areaRadius = Math.min(10, Math.max(0.5, Math.round(c.distanceTo(corner) / 100) / 10));
  loadRestaurants({ keepPage: false });
}

// ----------------------------------------------------------------------------
// Perfil do restaurante
// ----------------------------------------------------------------------------
async function openRestaurant(id) {
  showView('detail');
  const box = $('view-detail');
  const cached = currentRestaurants.find(r => String(r.id) === String(id));
  box.innerHTML = `<a class="back" href="#/">← Voltar</a>${stateBox('loading', 'Carregando o restaurante...')}`;
  const loc = searchCenter || userLocation || DEFAULT_LOC;
  let r = null;
  try { r = (await apiFetch(`/api/restaurants/${encodeURIComponent(id)}?lat=${loc.lat}&lng=${loc.lng}`)).restaurant; }
  catch (e) {
    if (cached) r = cached;
    else { box.innerHTML = `<a class="back" href="#/">← Voltar</a>${stateBox('error', e.message, '<button type="button" class="soft small" data-action="retry-route">Tentar de novo</button>')}`; return; }
  }
  if (decodeURIComponent(location.hash.replace(/^#\/restaurante\//, '')) !== String(id)) return;
  currentDetail = r;
  reviewPage = 1;
  document.title = `${r.name} · FoodFind`;
  box.innerHTML = r.registered ? registeredDetail(r) : osmDetail(r);
  const h = box.querySelector('h1');
  if (h && !firstRoute) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  loadReviews(r.id, 1);
  if (r.registered) loadPublicCampaigns(r);
}

function ratingPill(r) {
  return r.rating != null
    ? `<span class="pill"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-star"></use></svg> ${fmtRating(r.rating)} · ${plural(r.reviewCount, 'avaliação', 'avaliações')}</span>`
    : '<span class="pill"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-star"></use></svg> Sem avaliações</span>';
}

function openPill(r) {
  return r.openNow === true ? '<span class="pill open">● Aberto agora</span>' : r.openNow === false ? '<span class="pill closed">● Fechado agora</span>' : '';
}

function ownerActions(r) {
  if (r.registered) {
    return me && me.id === r.ownerId
      ? `<div class="owner-actions"><button type="button" class="primary" data-action="edit-restaurant" data-id="${Number(String(r.id).slice(3))}"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-edit"></use></svg> Editar informações</button><a class="soft" href="#/campanhas">Gerenciar campanhas</a></div>`
      : '';
  }
  if (me && me.role === 'restaurante') {
    if (r.myClaim && r.myClaim.status === 'pendente') return '<div class="claim-box"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-clock"></use></svg><div><b>Seu pedido para assumir este restaurante está em análise.</b><br><span class="mut">Enquanto estiver pendente, o restaurante não pode ser editado. Acompanhe no painel.</span></div><a class="soft" href="#/painel">Ver no painel</a></div>';
    if (r.claimPending) return '<div class="claim-box"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-clock"></use></svg><div><b>Já existe um pedido em análise para este restaurante.</b></div></div>';
    const refused = r.myClaim && r.myClaim.status === 'recusado' ? `<br><span class="error-text">Seu último pedido foi recusado: ${escapeHtml(r.myClaim.reason)}</span>` : '';
    return `<div class="claim-box"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-store"></use></svg><div><b>Este restaurante é seu?</b><br><span class="mut">Envie um pedido para assumir o perfil. Depois da aprovação do administrador você poderá adicionar fotos, cardápio, horários e campanhas.</span>${refused}</div><button type="button" class="primary" data-action="claim">Pedir para assumir</button></div>`;
  }
  if (!me) return '<div class="claim-box"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-store"></use></svg><div><b>É o dono deste lugar?</b><br><span class="mut">Crie uma conta de restaurante para atualizar as informações dele.</span></div><button type="button" class="primary" data-action="register-owner">Criar conta de restaurante</button></div>';
  return '';
}

function reviewsSection() {
  return `<section class="sprint3-section" aria-labelledby="revTitle">
      <h2 id="revTitle">Avaliações dos clientes</h2>
      <div id="reviewSummary">${stateBox('loading', 'Carregando avaliações...')}</div>
      <div id="reviewFormBox"></div>
      <ol id="reviewList" class="review-list"></ol>
      <nav id="reviewPager" class="pager" aria-label="Páginas de avaliações"></nav>
    </section>`;
}

function osmDetail(r) {
  const website = r.website ? `<a class="primary-link" href="${escapeHtml(r.website)}" target="_blank" rel="noopener noreferrer"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-globe"></use></svg> Site do estabelecimento ↗</a>` : '<span class="mut">Site não informado</span>';
  return `<a class="back" href="#/">← Voltar</a><article class="detail-card"><div class="detail-cover" aria-hidden="true">${categoryEmoji(r.category)}</div><div class="body">
    <p class="kicker">${escapeHtml(r.category)}</p><h1>${escapeHtml(r.name)}</h1><p>${escapeHtml(r.description)}</p>
    <div class="pills">${ratingPill(r)}${openPill(r)}<span class="pill"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-pin"></use></svg> ${escapeHtml(r.address)}</span><span class="pill"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-phone"></use></svg> ${escapeHtml(r.phone)}</span><span class="pill"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-clock"></use></svg> ${escapeHtml(r.hours)}</span></div>
    <div class="actions"><a class="action-btn" href="https://www.google.com/maps/dir/?api=1&destination=${Number(r.lat)},${Number(r.lng)}" target="_blank" rel="noopener noreferrer"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-route"></use></svg> Como chegar</a><button type="button" class="action-btn" data-action="goto-review"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-star"></use></svg> Avaliar restaurante</button></div>
    ${ownerActions(r)}
    <div class="cols"><div><h2>Informações</h2>${r.distance ? `<p>Distância: <b>${escapeHtml(r.distance)}</b></p>` : ''}<p>${website}</p><p class="mut">Dados públicos do OpenStreetMap. Algumas informações podem não estar cadastradas.</p></div>
    <div><h2>Cardápio</h2><p class="mut">O cardápio não está disponível nos dados públicos deste estabelecimento.</p><p>O FoodFind não processa pedidos. Quando houver site informado, você pode acessar o estabelecimento por lá.</p></div></div>
    ${reviewsSection()}
  </div></article>`;
}

function registeredDetail(r) {
  const photos = r.photos || [];
  const cover = photos.length
    ? `<div class="detail-cover has-photo"><img id="detailCover" src="${escapeHtml(photos[0])}" alt="Foto de capa de ${escapeHtml(r.name)}"></div>`
    : `<div class="detail-cover" aria-hidden="true">${categoryEmoji(r.category)}</div>`;
  const gallery = photos.length > 1
    ? `<div class="gallery" role="list" aria-label="Fotos">${photos.map((p, i) => `<button type="button" role="listitem" class="thumb${i === 0 ? ' active' : ''}" data-action="set-cover" data-src="${escapeHtml(p)}" aria-label="Ver foto ${i + 1} de ${photos.length}"><img src="${escapeHtml(p)}" alt=""></button>`).join('')}</div>` : '';
  const wa = r.whatsapp ? `https://wa.me/${r.whatsapp.length <= 11 ? '55' : ''}${r.whatsapp}` : '';
  const btn = (href, label, cls = 'action-btn') => href ? `<a class="${cls}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>` : '';
  const actions = [
    btn(r.website, '<svg class="i" aria-hidden="true" focusable="false"><use href="#i-globe"></use></svg> Visitar site ↗', 'action-btn main'),
    btn(r.deliveryUrl, '<svg class="i" aria-hidden="true" focusable="false"><use href="#i-bag"></use></svg> Pedir delivery'),
    btn(wa, '<svg class="i" aria-hidden="true" focusable="false"><use href="#i-chat"></use></svg> WhatsApp'),
    btn(r.instagram, '<svg class="i" aria-hidden="true" focusable="false"><use href="#i-camera"></use></svg> Instagram'),
    btn(r.menuUrl, '<svg class="i" aria-hidden="true" focusable="false"><use href="#i-menu"></use></svg> Cardápio completo'),
    btn(`https://www.google.com/maps/dir/?api=1&destination=${Number(r.lat)},${Number(r.lng)}`, '<svg class="i" aria-hidden="true" focusable="false"><use href="#i-route"></use></svg> Como chegar')
  ].join('') + '<button type="button" class="action-btn" data-action="goto-review"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-star"></use></svg> Avaliar restaurante</button>';
  const tk = todayKeySP();
  const hasSchedule = r.schedule && Object.values(r.schedule).some(d => !d.closed);
  const hoursTable = hasSchedule
    ? `<table class="hours-table"><caption class="sr-only">Horário de funcionamento</caption>${DAYS.map(([k, label]) => { const d = r.schedule[k] || { closed: true }; return `<tr class="${k === tk ? 'today' : ''}"><th scope="row">${label}${k === tk ? ' <span class="sr-only">(hoje)</span>' : ''}</th><td>${d.closed ? 'Fechado' : `${escapeHtml(d.open)} às ${escapeHtml(d.close)}`}</td></tr>`; }).join('')}</table>`
    : '<p class="mut">Horários não informados.</p>';
  const today = hasSchedule && r.schedule[tk] ? (r.schedule[tk].closed ? 'Fechado hoje' : `Hoje: ${r.schedule[tk].open} às ${r.schedule[tk].close}`) : 'Horário não informado';

  const sections = {};
  (r.menu || []).forEach(i => (sections[i.section] = sections[i.section] || []).push(i));
  const menuHtml = Object.keys(sections).length
    ? Object.entries(sections).map(([s, items]) => `<div class="menu-section"><h3>${escapeHtml(s)}</h3>${items.map(i => `<div class="menu-item"><div><b>${escapeHtml(i.name)}</b>${i.description ? `<p class="mut">${escapeHtml(i.description)}</p>` : ''}</div><span class="price">${money(i.price)}</span></div>`).join('')}</div>`).join('')
    : '<p class="mut">Este restaurante ainda não cadastrou o cardápio.</p>';

  return `<a class="back" href="#/">← Voltar</a><article class="detail-card">${cover}<div class="body">
    ${gallery}
    <p class="kicker">${escapeHtml(r.category)}${r.cuisine ? `, ${escapeHtml(r.cuisine)}` : ''}</p>
    <h1>${escapeHtml(r.name)} <span class="verified-lg" title="Informações atualizadas pelo próprio restaurante" aria-label="Verificado: informações atualizadas pelo próprio restaurante"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-check"></use></svg></span></h1>
    <p>${escapeHtml(r.description)}</p>
    <div class="pills">${ratingPill(r)}${openPill(r)}${r.priceRange ? `<span class="pill"> ${escapeHtml(r.priceRange)}</span>` : ''}<span class="pill"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-pin"></use></svg> ${escapeHtml(r.address)}</span><span class="pill"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-phone"></use></svg> ${escapeHtml(r.phone)}</span><span class="pill"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-clock"></use></svg> ${escapeHtml(today)}</span></div>
    <div class="actions">${actions}</div>
    ${ownerActions(r)}
    <div class="cols">
      <div><h2>Horário de funcionamento</h2>${hoursTable}
        <h2 class="mt">Informações</h2>${r.distance ? `<p>Distância: <b>${escapeHtml(r.distance)}</b></p>` : ''}
        <p class="mut">Informações atualizadas pelo próprio restaurante${r.updatedAt ? ` em ${fmtDate(r.updatedAt)}` : ''}.</p></div>
      <div><h2>Cardápio</h2>${menuHtml}</div>
    </div>
    ${reviewsSection()}
    <section class="sprint3-section" aria-labelledby="campPubTitle"><h2 id="campPubTitle">Campanhas e descontos</h2>
      <div id="campaignList" class="campaign-list">${stateBox('loading', 'Carregando ofertas...')}</div>
    </section>
  </div></article>`;
}

// ---- Avaliações ----
async function loadReviews(ref, page = 1) {
  reviewPage = page;
  if (!$('reviewSummary')) return;
  try {
    const data = await apiFetch(`/api/restaurants/${encodeURIComponent(ref)}/reviews?page=${page}&limit=5`);
    if (!currentDetail || currentDetail.id !== ref || !$('reviewSummary')) return;
    renderReviewSummary(data);
    renderReviewForm(data);
    $('reviewList').innerHTML = data.reviews.length
      ? data.reviews.map(v => `<li class="review-item${v.mine ? ' mine' : ''}"><div class="review-head"><b>${escapeHtml(v.author)}</b>${v.mine ? ' <span class="badge">Você</span>' : ''} <span class="rating" aria-label="${v.rating} de 5 estrelas">${stars(v.rating)}</span></div>
          ${v.comment ? `<p>${escapeHtml(v.comment)}</p>` : '<p class="mut">Sem comentário.</p>'}<small>${fmtDate(v.updatedAt)}${v.edited ? ' · editada' : ''}</small></li>`).join('')
      : '';
    $('reviewPager').innerHTML = data.pages > 1
      ? `<button type="button" class="soft small" data-action="review-page" data-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>← Mais recentes</button>
         <span>Página ${data.page} de ${data.pages}</span>
         <button type="button" class="soft small" data-action="review-page" data-page="${data.page + 1}" ${data.page >= data.pages ? 'disabled' : ''}>Mais antigas →</button>`
      : '';
  } catch (e) {
    if ($('reviewSummary')) $('reviewSummary').innerHTML = stateBox('error', e.message, '<button type="button" class="soft small" data-action="review-page" data-page="1">Tentar de novo</button>');
  }
}

function renderReviewSummary(data) {
  if (!data.count) {
    $('reviewSummary').innerHTML = stateBox('empty', 'Ainda não há avaliações. Seja o primeiro a avaliar!');
    return;
  }
  const rows = [5, 4, 3, 2, 1].map(n => `<div class="dist-row"><span>${n} <svg class="i" aria-hidden="true" focusable="false"><use href="#i-star"></use></svg><span class="sr-only">estrelas</span></span>
    <progress max="${data.count}" value="${data.distribution[n]}" aria-label="${n} estrelas: ${data.distribution[n]} avaliações"></progress><span>${data.distribution[n]}</span></div>`).join('');
  $('reviewSummary').innerHTML = `<div class="review-summary"><div class="avg"><b>${fmtRating(data.average)}</b><span class="rating" aria-hidden="true">${stars(data.average)}</span>
    <span class="mut">${plural(data.count, 'avaliação', 'avaliações')}</span></div><div class="dist" aria-label="Distribuição das notas">${rows}</div></div>`;
}

function reviewFormHtml(review) {
  const rating = review ? review.rating : 0;
  return `<form class="sprint3-form" data-form="review" aria-labelledby="reviewFormTitle">
    <h3 id="reviewFormTitle">${review ? 'Editar sua avaliação' : 'Avaliar este restaurante'}</h3>
    <fieldset class="star-input"><legend>Sua nota *</legend><div class="stars">
      ${[1, 2, 3, 4, 5].map(n => `<input type="radio" id="star${n}" name="rating" value="${n}" ${n === rating ? 'checked' : ''} required><label for="star${n}" title="${n} de 5"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-star"></use></svg><span class="sr-only">${n} ${n === 1 ? 'estrela' : 'estrelas'}</span></label>`).join('')}
    </div></fieldset>
    <label for="reviewComment">Comentário (opcional)</label>
    <textarea id="reviewComment" maxlength="600" rows="3" placeholder="Conte como foi sua experiência" aria-describedby="reviewCount">${escapeHtml(review ? review.comment : '')}</textarea>
    <small id="reviewCount" class="mut">${(review ? review.comment.length : 0)}/600 caracteres</small>
    <div class="inline-actions">
      ${review ? '<button type="button" class="soft" data-action="cancel-review">Cancelar</button>' : ''}
      <button class="primary" type="submit">${review ? 'Salvar alterações' : 'Enviar avaliação'}</button>
    </div>
    <p id="reviewMsg" role="alert"></p>
  </form>`;
}

function renderReviewForm(data) {
  const box = $('reviewFormBox');
  if (!data.canReview) {
    box.innerHTML = me
      ? `<p class="mut">${escapeHtml(data.reason)}</p>`
      : `<p class="mut">${escapeHtml(data.reason)} <button type="button" class="link-btn" data-action="login-review">Entrar</button></p>`;
    return;
  }
  box._mine = data.mine;
  if (data.mine) {
    box.innerHTML = `<div class="my-review"><div><b>Sua avaliação</b> <span class="rating" aria-label="${data.mine.rating} de 5 estrelas">${stars(data.mine.rating)}</span>
      <p>${data.mine.comment ? escapeHtml(data.mine.comment) : '<span class="mut">Sem comentário.</span>'}</p></div>
      <div class="inline-actions"><button type="button" class="soft small" data-action="edit-review">Editar</button><button type="button" class="danger small" data-action="delete-review">Excluir</button></div></div>`;
  } else box.innerHTML = reviewFormHtml(null);
}

async function submitReview(form) {
  const rating = Number((form.querySelector('input[name=rating]:checked') || {}).value);
  const msg = form.querySelector('#reviewMsg');
  if (!rating) { msg.textContent = 'Escolha uma nota de 1 a 5 estrelas.'; msg.className = 'error-text'; return; }
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await apiFetch(`/api/restaurants/${encodeURIComponent(currentDetail.id)}/reviews/mine`, { method: 'PUT', body: JSON.stringify({ rating, comment: form.querySelector('#reviewComment').value }) });
    setStatus('Avaliação salva com sucesso!', 'success');
    await refreshRatingAfterReview();
  } catch (e) { msg.textContent = e.message; msg.className = 'error-text'; btn.disabled = false; }
}

async function deleteReview() {
  const ok = await confirmDialog({ title: 'Excluir avaliação', text: 'Sua nota e seu comentário sobre este restaurante serão apagados.', okLabel: 'Excluir avaliação' });
  if (!ok) return;
  try {
    await apiFetch(`/api/restaurants/${encodeURIComponent(currentDetail.id)}/reviews/mine`, { method: 'DELETE' });
    setStatus('Avaliação excluída.', 'success');
    await refreshRatingAfterReview();
  } catch (e) { setStatus(e.message, 'error'); }
}

async function refreshRatingAfterReview() {
  const data = await apiFetch(`/api/restaurants/${encodeURIComponent(currentDetail.id)}/reviews?page=1&limit=5`);
  currentDetail.rating = data.count ? data.average : null;
  currentDetail.reviewCount = data.count;
  const item = currentRestaurants.find(r => r.id === currentDetail.id);
  if (item) { item.rating = currentDetail.rating; item.reviewCount = data.count; renderList(); }
  const pills = $('view-detail').querySelector('.pills');
  if (pills && pills.firstElementChild) pills.firstElementChild.outerHTML = ratingPill(currentDetail);
  loadReviews(currentDetail.id, 1);
}

// ---- Campanhas públicas (sem código) ----
async function loadPublicCampaigns(r) {
  const box = $('campaignList');
  try {
    const { campaigns } = await apiFetch(`/api/restaurants/${encodeURIComponent(r.id)}/campaigns`);
    if (!currentDetail || currentDetail.id !== r.id) return;
    const cta = !me
      ? '<p class="mut">Entre como cliente para resgatar no restaurante. <button type="button" class="link-btn" data-action="login">Entrar</button></p>'
      : me.role === 'cliente'
        ? '<button type="button" class="primary" data-action="scan"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-qr"></use></svg> Ler QR Code no restaurante</button><p class="mut">O QR Code fica exposto no próprio restaurante.</p>'
        : (me.id === r.ownerId ? '<a class="soft" href="#/campanhas">Gerenciar campanhas e ver o QR Code</a>' : '');
    box.innerHTML = campaigns.length
      ? campaigns.map(c => `<article class="campaign-item"><div><h3>${escapeHtml(c.title)}</h3><b class="discount">${escapeHtml(c.discountLabel)}</b>
          <p>${escapeHtml(c.benefit)}</p><p class="mut">Válida até ${escapeHtml(fmtDateTime(c.endsAt))} · ${c.hasSlots ? '<span class="ok-text">Vagas disponíveis</span>' : '<span class="error-text">Esgotada</span>'}</p></div></article>`).join('') + `<div class="campaign-cta">${cta}</div>`
      : stateBox('empty', 'Nenhuma campanha ativa no momento.') + (me && me.id === r.ownerId ? '<a class="soft" href="#/campanhas">Criar campanha</a>' : '');
  } catch (e) { box.innerHTML = stateBox('error', e.message); }
}

// ----------------------------------------------------------------------------
// Leitor de QR Code e resgate
// ----------------------------------------------------------------------------
let scanStream = null, scanTimer = null, detector = null;

function openScanner(code = '') {
  if (!me) {
    pendingAfterLogin = () => openScanner(code);
    openAuth('login', { notice: 'Entre como cliente para ler o QR Code e resgatar o benefício.' });
    return;
  }
  if (me.role !== 'cliente') { setStatus('Somente contas do tipo Cliente resgatam benefícios.', 'error'); return; }
  $('redeemMessage').innerHTML = '';
  $('redeemCode').value = code;
  $('scanStatus').textContent = window.isSecureContext && navigator.mediaDevices
    ? 'Toque em "Abrir câmera" para ler o QR Code.'
    : 'A câmera só funciona em conexões seguras (HTTPS). Digite o código impresso abaixo do QR Code.';
  $('scanStart').classList.toggle('hide', !(window.isSecureContext && navigator.mediaDevices));
  openModal('scanModal', code ? '#redeemCode' : '#scanStart');
}

function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = JSQR.src;
    s.integrity = JSQR.integrity;
    s.crossOrigin = 'anonymous';
    s.onload = () => (window.jsQR ? resolve(window.jsQR) : reject(new Error('jsQR indisponível')));
    s.onerror = () => reject(new Error('Não foi possível carregar o leitor de QR Code.'));
    document.head.appendChild(s);
  });
}

async function startScan() {
  const status = $('scanStatus');
  const video = $('scanVideo');
  try {
    status.textContent = 'Abrindo a câmera...';
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    video.srcObject = scanStream;
    video.classList.remove('hide');
    $('scanStart').classList.add('hide');
    await video.play();
    detector = null;
    if ('BarcodeDetector' in window) {
      try {
        const formats = BarcodeDetector.getSupportedFormats ? await BarcodeDetector.getSupportedFormats() : ['qr_code'];
        if (formats.includes('qr_code')) detector = new BarcodeDetector({ formats: ['qr_code'] });
      } catch { detector = null; }
    }
    if (!detector) { status.textContent = 'Carregando o leitor...'; await loadJsQR(); }
    status.textContent = 'Aponte a câmera para o QR Code.';
    scanLoop();
  } catch (e) {
    stopScan();
    status.textContent = e && e.name === 'NotAllowedError'
      ? 'Permissão da câmera negada. Libere a câmera nas configurações do navegador ou digite o código.'
      : `Não foi possível usar a câmera (${e.message || 'erro desconhecido'}). Digite o código impresso abaixo do QR Code.`;
    $('scanStart').classList.remove('hide');
  }
}

function scanLoop() {
  const video = $('scanVideo');
  const canvas = $('scanCanvas');
  const tick = async () => {
    if (!scanStream) return;
    let value = null;
    try {
      if (video.readyState >= 2) {
        if (detector) {
          const codes = await detector.detect(video);
          if (codes.length) value = codes[0].rawValue;
        } else if (window.jsQR) {
          const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const found = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (found) value = found.data;
        }
      }
    } catch { /* quadro ilegível: tenta o próximo */ }
    if (value) {
      stopScan();
      $('scanStatus').textContent = 'QR Code lido! Resgatando...';
      $('redeemCode').value = extractCode(value);
      redeem(value);
      return;
    }
    scanTimer = setTimeout(tick, 200);
  };
  tick();
}

function stopScan() {
  clearTimeout(scanTimer);
  if (scanStream) scanStream.getTracks().forEach(t => t.stop());
  scanStream = null;
  const video = $('scanVideo');
  video.srcObject = null;
  video.classList.add('hide');
}

function extractCode(value) {
  const m = /[?&]resgatar=([^&#\s]+)/i.exec(String(value));
  let code = m ? m[1] : String(value);
  try { code = decodeURIComponent(code); } catch { /* mantém */ }
  return code.trim();
}

const REDEEM_TITLES = {
  invalid_code: ['x', 'Código inválido'],
  campaign_not_started: ['clock', 'Campanha ainda não começou'],
  campaign_ended: ['clock', 'Campanha encerrada'],
  campaign_paused: ['clock', 'Campanha pausada'],
  campaign_sold_out: ['ticket', 'Campanha esgotada'],
  already_redeemed: ['check', 'Você já resgatou esta campanha'],
  not_client: ['user', 'Apenas clientes resgatam'],
  too_many_attempts: ['shield', 'Muitas tentativas'],
  missing_code: ['qr', 'Informe o código']
};

async function redeem(raw) {
  const code = extractCode(raw);
  const msg = $('redeemMessage');
  if (!code) { msg.innerHTML = '<p class="error-text">Informe ou leia o código do QR Code.</p>'; return; }
  msg.innerHTML = '<p class="mut">Resgatando...</p>';
  try {
    const data = await apiFetch('/api/campaigns/redeem', { method: 'POST', body: JSON.stringify({ code }) });
    closeModal('scanModal');
    showVoucher(data.voucher, true);
    setStatus(`${data.message} Voucher ${data.voucher.voucher} emitido.`, 'success');
  } catch (e) {
    if (e.code === 'auth_required') {
      session('ff_pending_redeem', code);
      closeModal('scanModal');
      openAuth('login', { notice: 'Entre como cliente para concluir o resgate.' });
      return;
    }
    const [glyph, title] = REDEEM_TITLES[e.code] || ['alert', 'Não foi possível resgatar'];
    msg.innerHTML = `<div class="redeem-error"><b>${icon(glyph)} ${escapeHtml(title)}</b><p>${escapeHtml(e.message)}</p>
      ${e.code === 'already_redeemed' ? '<a href="#/beneficios" data-action="close-modal">Ver meus benefícios</a>' : ''}</div>`;
  }
}

function processPendingRedeem() {
  const code = session('ff_pending_redeem');
  if (!code) return;
  if (!me) {
    openAuth('login', { notice: 'Você leu o QR Code de uma campanha. Entre como cliente (ou crie sua conta) para resgatar; o resgate continua automaticamente depois do login.' });
    return;
  }
  session('ff_pending_redeem', null);
  if (me.role !== 'cliente') { setStatus('Este QR Code é de uma campanha para clientes. Contas do tipo Restaurante não resgatam benefícios.', 'error'); return; }
  openScanner(code);
  redeem(code);
}

function showVoucher(v, fresh = false) {
  const status = v.status === 'usado' ? 'used' : v.expired ? 'expired' : 'issued';
  $('voucherBody').innerHTML = `<div class="voucher ${status}">
    <p class="voucher-kicker">${fresh ? 'Resgate confirmado' : 'Comprovante de benefício'}</p>
    <h2 id="voucherModalTitle">${escapeHtml(v.restaurantName)}</h2>
    <p class="voucher-benefit">${escapeHtml(v.discountLabel)}</p>
    <p><b>${escapeHtml(v.campaignTitle)}</b><br>${escapeHtml(v.benefit)}</p>
    <div class="voucher-codes">
      <div><span>Voucher</span><b>${escapeHtml(v.voucher)}</b></div>
      <div><span>Código de conferência</span><b>${escapeHtml(v.checkCode || '')}</b></div>
    </div>
    <p>Válido até <b>${escapeHtml(fmtDateTime(v.validUntil))}</b></p>
    <p class="status-badge ${status}">${escapeHtml(v.statusLabel)}${v.usedAt ? ` em ${escapeHtml(fmtDateTime(v.usedAt))}` : ''}</p>
    <p class="mut">Mostre este comprovante no caixa. O restaurante confere o número e o código de conferência. O voucher só pode ser usado uma vez.</p>
    <div class="inline-actions"><a class="soft" href="#/beneficios" data-action="close-modal">Meus benefícios</a><a class="soft" href="#/restaurante/${encodeURIComponent(v.restaurantId)}" data-action="close-modal">Ver restaurante</a></div>
  </div>`;
  openModal('voucherModal');
}

// ----------------------------------------------------------------------------
// Meus benefícios (cliente)
// ----------------------------------------------------------------------------
let myVouchers = [];
async function openBenefits() {
  showView('benefits');
  const box = $('benefitsList');
  box.innerHTML = stateBox('loading', 'Carregando seus benefícios...');
  try {
    myVouchers = (await apiFetch('/api/me/redemptions')).redemptions;
    box.innerHTML = myVouchers.length
      ? `<ul class="voucher-list">${myVouchers.map((v, i) => {
        const status = v.status === 'usado' ? 'used' : v.expired ? 'expired' : 'issued';
        return `<li class="card-box voucher-row"><div><b>${escapeHtml(v.restaurantName)}</b><br>${escapeHtml(v.campaignTitle)} · <span class="discount">${escapeHtml(v.discountLabel)}</span>
          <br><span class="mut">Voucher ${escapeHtml(v.voucher)} · resgatado em ${escapeHtml(fmtDateTime(v.redeemedAt))} · válido até ${escapeHtml(fmtDateTime(v.validUntil))}</span></div>
          <span class="status-badge ${status}">${escapeHtml(v.statusLabel)}</span>
          <button type="button" class="soft small" data-action="show-voucher" data-i="${i}">Ver comprovante</button></li>`;
      }).join('')}</ul>`
      : stateBox('empty', 'Você ainda não resgatou benefícios. Procure restaurantes com campanhas e leia o QR Code no balcão.', '<a class="soft" href="#/">Buscar restaurantes</a>');
  } catch (e) { box.innerHTML = stateBox('error', e.message, '<button type="button" class="soft small" data-action="retry-route">Tentar de novo</button>'); }
}

// ----------------------------------------------------------------------------
// Painel do restaurante
// ----------------------------------------------------------------------------
async function openPanel() {
  showView('panel');
  const pending = editing && (editing.pendingEdit || editing.pendingClaim) ? editing : null;
  if (pending || !editing) { editing = null; $('rForm').classList.add('hide'); }
  await Promise.all([loadMyRestaurants(), loadMyClaims()]);
  if (pending && pending.pendingEdit) { const r = myRestaurants.find(x => x.id === pending.pendingEdit); if (r) fillForm(r); }
  if (pending && pending.pendingClaim) fillForm(pending.pendingClaim, { claim: true });
}

async function loadMyRestaurants() {
  $('myList').innerHTML = stateBox('loading', 'Carregando seus restaurantes...');
  try { myRestaurants = (await apiFetch('/api/my/restaurants')).restaurants; }
  catch (e) { myRestaurants = []; $('myList').innerHTML = stateBox('error', e.message, '<button type="button" class="soft small" data-action="retry-route">Tentar de novo</button>'); return; }
  $('myList').innerHTML = myRestaurants.length
    ? myRestaurants.map(r => `<article class="my-card">
        ${r.photos[0] ? `<img src="${escapeHtml(r.photos[0])}" alt="">` : `<div class="food-icon" aria-hidden="true">${categoryEmoji(r.category)}</div>`}
        <div class="grow"><h3>${escapeHtml(r.name)}</h3><div class="mut">${escapeHtml(r.category)} · ${escapeHtml(r.address || 'Sem endereço')}</div>
        <div class="mut">${r.rating != null ? `<svg class="i" aria-hidden="true" focusable="false"><use href="#i-star"></use></svg> ${fmtRating(r.rating)} (${plural(r.reviewCount, 'avaliação', 'avaliações')})` : 'Sem avaliações'} · ${plural(r.activeCampaigns, 'campanha vigente', 'campanhas vigentes')} · ${r.menu.length} item(ns) no cardápio · ${r.photos.length} foto(s)</div>
        <div class="mut">Atualizado em ${escapeHtml(fmtDateTime(r.updatedAt))}${r.osmRef ? ' · <svg class="i" aria-hidden="true" focusable="false"><use href="#i-pin"></use></svg> assumido do mapa' : ''}</div></div>
        <div class="my-actions"><a class="soft small" href="#/restaurante/${r.publicId}">Ver perfil</a><button type="button" class="primary small" data-action="edit-restaurant" data-id="${r.id}">Editar</button><button type="button" class="danger small" data-action="delete-restaurant" data-id="${r.id}">Excluir</button></div>
      </article>`).join('')
    : stateBox('empty', 'Você ainda não cadastrou nenhum restaurante. Clique em "+ Cadastrar restaurante" para começar, ou abra um restaurante do mapa e use "Pedir para assumir" se ele já aparecer na busca.');
}

async function loadMyClaims() {
  const box = $('myClaims');
  try { myClaims = (await apiFetch('/api/my/claims')).claims; }
  catch (e) { box.innerHTML = stateBox('error', e.message); return; }
  const label = { pendente: 'Pendente', aprovado: 'Aprovado', recusado: 'Recusado' };
  box.innerHTML = myClaims.length
    ? `<h2 class="section-title">Pedidos para assumir restaurantes</h2><ul class="claim-list">${myClaims.map(c => `<li class="card-box"><div><b>${escapeHtml(c.name)}</b> <span class="status-badge claim-${c.status}">${label[c.status]}</span>
        <br><span class="mut">Enviado em ${escapeHtml(fmtDateTime(c.createdAt))}${c.decidedAt ? ` · analisado em ${escapeHtml(fmtDateTime(c.decidedAt))}` : ''}</span>
        ${c.status === 'recusado' && c.reason ? `<br><span class="error-text">Motivo: ${escapeHtml(c.reason)}</span>` : ''}
        ${c.status === 'pendente' ? '<br><span class="mut">Em análise pelo administrador. O restaurante não pode ser editado enquanto o pedido estiver pendente.</span>' : ''}</div>
        <div class="my-actions">${c.status === 'aprovado' && c.restaurantId ? `<a class="soft small" href="#/restaurante/${c.restaurantId}">Ver perfil</a>` : ''}${c.status === 'pendente' ? `<button type="button" class="danger small" data-action="cancel-claim" data-id="${c.id}">Cancelar pedido</button>` : ''}</div></li>`).join('')}</ul>`
    : '';
}

function emptyHours() { return Object.fromEntries(DAYS.map(([k]) => [k, { closed: false, open: '11:00', close: '22:00' }])); }

function fillForm(data, { claim = false } = {}) {
  editing = { id: data.id || null, claimRef: claim ? data.osmRef : null, photos: [...(data.photos || [])] };
  $('rFormTitle').textContent = claim ? `Pedido para assumir: ${data.name}` : data.id ? `Editar: ${data.name}` : 'Novo restaurante';
  $('rLinked').textContent = data.osmRef ? 'Vinculado ao restaurante que já aparece no mapa' : '';
  $('rLinked').classList.toggle('hide', !data.osmRef);
  $('claimInfo').classList.toggle('hide', !claim);
  $('rMessage').value = '';
  $('rSave').textContent = claim ? 'Enviar pedido' : 'Salvar restaurante';
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
  if (rMap) {
    if (Number.isFinite(data.lat) && Number.isFinite(data.lng)) setFormLocation(data.lat, data.lng, 17);
    else {
      if (rMarker) { rMap.removeLayer(rMarker); rMarker = null; }
      const c = searchCenter || userLocation || (map ? map.getCenter() : DEFAULT_LOC);
      rMap.setView([c.lat, c.lng], 14);
      updateCoordsText();
    }
  } else if (Number.isFinite(data.lat)) editing.fallbackPos = { lat: data.lat, lng: data.lng };
  $('rForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('rFormTitle').focus({ preventScroll: true });
}

function editRestaurant(id) {
  const go = () => { const r = myRestaurants.find(x => x.id === id); if (r) fillForm(r); };
  if (!location.hash.startsWith('#/painel')) { editing = { pendingEdit: id }; location.hash = '#/painel'; return; }
  go();
}

function claimRestaurant() {
  const r = currentDetail;
  if (!r) return;
  const data = {
    osmRef: r.id, name: r.name, category: r.category, cuisine: r.cuisine,
    description: r.description && !r.description.startsWith('Estabelecimento encontrado') ? r.description : '',
    website: r.website, phone: r.phone !== 'Telefone não informado' ? r.phone : '',
    address: r.address !== 'Endereço não informado' ? r.address : '', lat: r.lat, lng: r.lng
  };
  editing = { pendingClaim: data };
  location.hash = '#/painel';
}

function cancelEdit() { $('rForm').classList.add('hide'); editing = null; window.scrollTo(0, 0); }

async function deleteRestaurant(id) {
  const r = myRestaurants.find(x => x.id === id);
  if (!r) return;
  const ok = await confirmDialog({ title: 'Excluir restaurante', text: `Excluir "${r.name}" do FoodFind? As fotos, campanhas e vouchers dele também serão apagados. Essa ação não pode ser desfeita.`, okLabel: 'Excluir' });
  if (!ok) return;
  try {
    await apiFetch(`/api/my/restaurants/${id}`, { method: 'DELETE' });
    if (editing && editing.id === id) cancelEdit();
    setStatus(`"${r.name}" foi excluído.`, 'success');
    await loadMyRestaurants();
    loadRestaurants({ keepPage: true, silent: true });
  } catch (e) { setStatus(e.message, 'error'); }
}

async function cancelClaim(id) {
  const ok = await confirmDialog({ title: 'Cancelar pedido', text: 'O pedido para assumir este restaurante será cancelado.', okLabel: 'Cancelar pedido' });
  if (!ok) return;
  try { await apiFetch(`/api/my/claims/${id}`, { method: 'DELETE' }); setStatus('Pedido cancelado.', 'success'); loadMyClaims(); }
  catch (e) { setStatus(e.message, 'error'); }
}

function initFormMap() {
  if (!window.L) { $('rMap').innerHTML = stateBox('error', 'O mapa não carregou. Use "Localizar no mapa" pelo endereço ou "Minha localização".'); return; }
  if (!rMap) {
    rMap = L.map('rMap', { maxZoom: 19 }).setView([DEFAULT_LOC.lat, DEFAULT_LOC.lng], 14);
    addBaseLayer(rMap);
    rMap.on('click', e => setFormLocation(e.latlng.lat, e.latlng.lng));
  }
  setTimeout(() => rMap.invalidateSize(), 60);
}

function setFormLocation(lat, lng, zoom) {
  if (!rMap) { editing.fallbackPos = { lat, lng }; updateCoordsText(); return; }
  if (!rMarker) {
    rMarker = L.marker([lat, lng], { draggable: true, icon: pinIcon({ registered: true }), title: 'Local do restaurante (arraste para ajustar)' }).addTo(rMap);
    rMarker.on('dragend', updateCoordsText);
  } else rMarker.setLatLng([lat, lng]);
  rMap.setView([lat, lng], zoom || Math.max(rMap.getZoom(), 16));
  updateCoordsText();
}

function formPosition() {
  if (rMarker) return rMarker.getLatLng();
  return editing && editing.fallbackPos ? editing.fallbackPos : null;
}

function updateCoordsText() {
  const pos = formPosition();
  $('rCoords').textContent = pos
    ? `Localização marcada (${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}). Arraste o marcador para ajustar.`
    : 'Clique no mapa para marcar onde fica o restaurante. Depois é só arrastar o marcador para ajustar.';
}

async function geocodeForm() {
  const q = $('rAddress').value.trim();
  const box = $('geoResults');
  if (q.length < 3) return;
  box.innerHTML = '<span class="mut">Buscando endereço...</span>';
  box.classList.remove('hide');
  try {
    const { results } = await apiFetch(`/api/geocode?q=${encodeURIComponent(q)}`);
    if (!results.length) { box.innerHTML = '<span class="mut">Endereço não encontrado. Tente incluir número, bairro e cidade, ou marque direto no mapa.</span>'; return; }
    box._results = results;
    box.innerHTML = results.map((r, i) => `<button type="button" data-action="pick-form-address" data-i="${i}"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-pin"></use></svg> ${escapeHtml(r.label)}</button>`).join('');
  } catch (e) { box.innerHTML = `<span class="error-text">${escapeHtml(e.message)}</span>`; }
}

function useMyLocationForForm() {
  if (!navigator.geolocation) return showFormError('Seu navegador não oferece geolocalização.');
  navigator.geolocation.getCurrentPosition(p => setFormLocation(p.coords.latitude, p.coords.longitude, 17), () => showFormError('Não foi possível obter sua localização. Marque o local no mapa.'), { enableHighAccuracy: true, timeout: 10000 });
}

function renderHours(hours) {
  $('hoursRows').innerHTML = DAYS.map(([k, label]) => {
    const d = hours[k] || { closed: true, open: '', close: '' };
    return `<div class="hours-row${d.closed ? ' is-closed' : ''}" data-day="${k}" role="group" aria-label="${label}">
      <span class="day" aria-hidden="true">${label}</span>
      <label class="closed-toggle"><input type="checkbox" ${d.closed ? 'checked' : ''}> Fechado<span class="sr-only"> na ${label}</span></label>
      <label class="sr-only" for="open-${k}">Abre (${label})</label><input id="open-${k}" type="time" value="${escapeHtml(d.open || '11:00')}"><span class="mut" aria-hidden="true">às</span>
      <label class="sr-only" for="close-${k}">Fecha (${label})</label><input id="close-${k}" type="time" value="${escapeHtml(d.close || '22:00')}">
    </div>`;
  }).join('');
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
  const closed = rows[0].querySelector('input[type=checkbox]').checked;
  const [o, c] = [...rows[0].querySelectorAll('input[type=time]')].map(i => i.value);
  rows.slice(1).forEach(row => {
    row.querySelector('input[type=checkbox]').checked = closed;
    const t = row.querySelectorAll('input[type=time]'); t[0].value = o; t[1].value = c;
    row.classList.toggle('is-closed', closed);
  });
}

let menuSeq = 0;
function addMenuItem(item = {}) {
  const n = ++menuSeq;
  const row = document.createElement('div');
  row.className = 'menu-row';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', `Item ${n} do cardápio`);
  row.innerHTML = `
    <label class="sr-only" for="ms${n}">Seção</label><input id="ms${n}" class="m-section" list="sectionList" placeholder="Seção (ex.: Pizzas)" value="${escapeHtml(item.section || '')}">
    <label class="sr-only" for="mn${n}">Nome do prato</label><input id="mn${n}" class="m-name" placeholder="Nome do prato" value="${escapeHtml(item.name || '')}">
    <label class="sr-only" for="mp${n}">Preço em reais</label><input id="mp${n}" class="m-price" inputmode="decimal" placeholder="Preço (R$)" value="${item.price != null ? String(item.price).replace('.', ',') : ''}">
    <label class="sr-only" for="md${n}">Descrição</label><input id="md${n}" class="m-desc" placeholder="Descrição (opcional)" value="${escapeHtml(item.description || '')}">
    <button type="button" class="icon-btn" data-action="remove-menu-item" aria-label="Remover item ${n}"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-x"></use></svg></button>`;
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
  $('photoGrid').innerHTML = editing.photos.length ? editing.photos.map((p, i) => `
    <div class="photo">
      <img src="${escapeHtml(p)}" alt="Foto ${i + 1}${i === 0 ? ' (capa)' : ''}">
      ${i === 0 ? '<span class="cover-tag">Capa</span>' : `<button type="button" class="ph-btn left" data-action="make-cover" data-i="${i}" aria-label="Usar a foto ${i + 1} como capa">Usar como capa</button>`}
      <button type="button" class="ph-btn right" data-action="remove-photo" data-i="${i}" aria-label="Remover a foto ${i + 1}"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-x"></use></svg></button>
    </div>`).join('') : '<p class="mut">Nenhuma foto ainda.</p>';
}

function resizeImage(file, max = 1280) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return reject(new Error(`"${file.name}" não é JPG, PNG ou WEBP.`));
    if (file.size > 15 * 1024 * 1024) return reject(new Error(`"${file.name}" é grande demais.`));
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

async function saveRestaurant() {
  $('rError').classList.add('hide');
  if (!$('rName').value.trim()) { $('rName').focus(); return showFormError('Informe o nome do restaurante.'); }
  const pos = formPosition();
  if (!pos) return showFormError('Marque a localização do restaurante no mapa (seção 3).');
  const body = {
    name: $('rName').value, category: $('rCategory').value, priceRange: $('rPrice').value, cuisine: $('rCuisine').value,
    description: $('rDescription').value, website: $('rWebsite').value, phone: $('rPhone').value, whatsapp: $('rWhatsapp').value,
    instagram: $('rInstagram').value, deliveryUrl: $('rDelivery').value, menuUrl: $('rMenuUrl').value,
    address: $('rAddress').value, lat: pos.lat, lng: pos.lng,
    hours: readHours(), menu: readMenu(), photos: editing.photos
  };
  const btn = $('rSave');
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Salvando...';
  try {
    if (editing.claimRef) {
      await apiFetch('/api/my/claims', { method: 'POST', body: JSON.stringify({ ...body, osmRef: editing.claimRef, message: $('rMessage').value }) });
      cancelEdit();
      await loadMyClaims();
      setStatus('Pedido enviado! O administrador vai analisar e você verá o resultado aqui no painel.', 'success');
      return;
    }
    const url = editing.id ? `/api/my/restaurants/${editing.id}` : '/api/my/restaurants';
    const { restaurant } = await apiFetch(url, { method: editing.id ? 'PUT' : 'POST', body: JSON.stringify(body) });
    cancelEdit();
    await loadMyRestaurants();
    loadRestaurants({ keepPage: true, silent: true });
    setStatus(`"${restaurant.name}" salvo! As informações já aparecem na busca.`, 'success');
    $('myList').insertAdjacentHTML('afterbegin', `<div class="saved-msg" role="status"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-check"></use></svg> "${escapeHtml(restaurant.name)}" salvo com sucesso. As informações já aparecem na lista de restaurantes.</div>`);
  } catch (err) { showFormError(err.message); }
  finally { btn.disabled = false; btn.textContent = label; }
}

// ----------------------------------------------------------------------------
// Campanhas (dono)
// ----------------------------------------------------------------------------
const STATUS_LABEL = { ativa: 'Ativa', agendada: 'Agendada', pausada: 'Pausada', encerrada: 'Encerrada', esgotada: 'Esgotada' };

async function openCampaigns() {
  showView('campaigns');
  $('cForm').classList.add('hide');
  editingCampaign = null;
  const box = $('campaignAdminList');
  box.innerHTML = stateBox('loading', 'Carregando campanhas...');
  try {
    const [rs, cs] = await Promise.all([apiFetch('/api/my/restaurants'), apiFetch('/api/my/campaigns')]);
    myRestaurants = rs.restaurants;
    myCampaigns = cs.campaigns;
    renderCampaignAdmin();
  } catch (e) { box.innerHTML = stateBox('error', e.message, '<button type="button" class="soft small" data-action="retry-route">Tentar de novo</button>'); }
}

function renderCampaignAdmin() {
  const box = $('campaignAdminList');
  if (!myRestaurants.length) {
    box.innerHTML = stateBox('empty', 'Cadastre um restaurante antes de criar campanhas.', '<a class="primary" href="#/painel">Ir para o painel</a>');
    return;
  }
  if (!myCampaigns.length) {
    box.innerHTML = stateBox('empty', 'Nenhuma campanha criada ainda. Clique em "+ Nova campanha".');
    return;
  }
  box.innerHTML = `<h2 class="section-title">Suas campanhas</h2>` + myCampaigns.map(c => `<article class="campaign-admin card-box">
    <div class="grow">
      <div class="c-head"><h3>${escapeHtml(c.title)}</h3><span class="status-badge st-${c.status}">${STATUS_LABEL[c.status]}</span></div>
      <p class="mut">${escapeHtml(c.restaurantName)}</p>
      <p><b class="discount">${escapeHtml(c.discountLabel)}</b> · ${escapeHtml(c.description)}</p>
      <p class="mut">De ${escapeHtml(fmtDateTime(c.startsAt))} até ${escapeHtml(fmtDateTime(c.endsAt))}</p>
      <p class="mut">Usos: <b>${c.redemptionCount}</b>${c.maxRedemptions ? ` de ${c.maxRedemptions}` : ' (sem limite)'} · vouchers validados: ${c.vouchersUsed}</p>
    </div>
    <div class="my-actions">
      <button type="button" class="primary small" data-action="show-qr" data-id="${c.id}"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-qr"></use></svg> QR Code</button>
      <button type="button" class="soft small" data-action="edit-campaign" data-id="${c.id}">Editar</button>
      ${c.status !== 'encerrada' ? `<button type="button" class="soft small" data-action="toggle-campaign" data-id="${c.id}">${c.active ? 'Pausar' : 'Ativar'}</button>` : ''}
      <button type="button" class="soft small" data-action="campaign-vouchers" data-id="${c.id}">Vouchers</button>
      <button type="button" class="danger small" data-action="delete-campaign" data-id="${c.id}">Excluir</button>
    </div>
  </article>`).join('');
}

function fillCampaignForm(c) {
  editingCampaign = c ? c.id : null;
  $('cFormTitle').textContent = c ? `Editar: ${c.title}` : 'Nova campanha';
  $('cError').classList.add('hide');
  $('cRestaurant').innerHTML = myRestaurants.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  $('cRestaurant').disabled = Boolean(c);
  $('cRestaurant').value = c ? c.restaurantId : (myRestaurants[0] || {}).id;
  $('cTitle').value = c ? c.title : '';
  $('cDescription').value = c ? c.description : '';
  $('cType').value = c ? c.discountType : 'percent';
  $('cValue').value = c ? c.discountValue : '';
  const now = new Date();
  $('cStart').value = c ? c.startsAtLocal : spInput(now);
  $('cEnd').value = c ? c.endsAtLocal : spInput(new Date(now.getTime() + 30 * 86400000));
  $('cLimit').value = c && c.maxRedemptions ? c.maxRedemptions : '';
  $('cForm').classList.remove('hide');
  $('cForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('cFormTitle').focus({ preventScroll: true });
}

function newCampaign() {
  if (!myRestaurants.length) { setStatus('Cadastre um restaurante antes de criar campanhas.', 'error'); location.hash = '#/painel'; return; }
  fillCampaignForm(null);
}

async function saveCampaign() {
  const err = $('cError');
  err.classList.add('hide');
  const payload = {
    restaurantId: Number($('cRestaurant').value), title: $('cTitle').value.trim(), description: $('cDescription').value.trim(),
    discountType: $('cType').value, discountValue: Number($('cValue').value),
    startsAt: $('cStart').value, endsAt: $('cEnd').value, maxRedemptions: $('cLimit').value ? Number($('cLimit').value) : null
  };
  const fail = m => { err.textContent = m; err.classList.remove('hide'); err.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  if (!payload.title) return fail('Informe o título da campanha.');
  if (!payload.description) return fail('Descreva o benefício da campanha.');
  if (!(payload.discountValue > 0)) return fail('Informe o valor do desconto.');
  if (!payload.startsAt || !payload.endsAt) return fail('Informe o início e o fim da campanha.');
  if (payload.endsAt <= payload.startsAt) return fail('A data de fim deve ser posterior à data de início.');
  const btn = $('cSave');
  btn.disabled = true;
  try {
    const { campaign } = await apiFetch(editingCampaign ? `/api/my/campaigns/${editingCampaign}` : '/api/my/campaigns', { method: editingCampaign ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    const wasNew = !editingCampaign;
    $('cForm').classList.add('hide');
    editingCampaign = null;
    myCampaigns = (await apiFetch('/api/my/campaigns')).campaigns;
    renderCampaignAdmin();
    setStatus(wasNew ? 'Campanha criada! Imprima o QR Code e deixe no balcão.' : 'Campanha atualizada.', 'success');
    if (wasNew) showQr(campaign.id);
  } catch (e) { fail(e.message); }
  finally { btn.disabled = false; }
}

async function toggleCampaign(id) {
  const c = myCampaigns.find(x => x.id === id);
  try {
    await apiFetch(`/api/my/campaigns/${id}/status`, { method: 'POST', body: JSON.stringify({ active: !c.active }) });
    myCampaigns = (await apiFetch('/api/my/campaigns')).campaigns;
    renderCampaignAdmin();
    setStatus(c.active ? 'Campanha pausada. Os clientes não conseguem resgatar enquanto estiver pausada.' : 'Campanha ativada.', 'success');
  } catch (e) { setStatus(e.message, 'error'); }
}

async function deleteCampaign(id) {
  const c = myCampaigns.find(x => x.id === id);
  const ok = await confirmDialog({ title: 'Excluir campanha', text: `Excluir "${c.title}"? ${c.redemptionCount ? `Os ${c.redemptionCount} resgates/vouchers desta campanha também serão apagados. ` : ''}O QR Code impresso deixará de funcionar.`, okLabel: 'Excluir campanha' });
  if (!ok) return;
  try {
    await apiFetch(`/api/my/campaigns/${id}`, { method: 'DELETE' });
    myCampaigns = myCampaigns.filter(x => x.id !== id);
    renderCampaignAdmin();
    setStatus('Campanha excluída.', 'success');
  } catch (e) { setStatus(e.message, 'error'); }
}

function showQr(id) {
  const c = myCampaigns.find(x => x.id === id);
  if (!c) return;
  const src = `${c.qrUrl}?v=${encodeURIComponent(c.updatedAt)}`;
  $('qrBody').innerHTML = `<h2 id="qrModalTitle">QR Code: ${escapeHtml(c.title)}</h2>
    <p class="mut">${escapeHtml(c.restaurantName)} · <span class="status-badge st-${c.status}">${STATUS_LABEL[c.status]}</span></p>
    <div class="qr-big"><img src="${escapeHtml(src)}" alt="QR Code da campanha ${escapeHtml(c.title)}. Leva para o link de resgate." width="320" height="320"></div>
    <p class="qr-code-text">Código: <b>${escapeHtml(c.codeFormatted)}</b></p>
    <label for="qrLink">Link de resgate</label>
    <div class="inline"><input id="qrLink" readonly value="${escapeHtml(c.redeemUrl)}"><button type="button" class="soft" data-action="copy-link">Copiar link</button></div>
    <p class="mut">Este código é secreto: só aparece para você. Deixe o QR Code impresso no restaurante para que apenas quem estiver no local possa resgatar.</p>
    <div class="inline-actions">
      <button type="button" class="primary" data-action="print-qr" data-id="${c.id}"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-printer"></use></svg> Imprimir cartaz (A5)</button>
      <a class="soft" href="${escapeHtml(c.qrUrl)}?download=1" download="foodfind-campanha-${c.id}-qrcode.svg"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-download"></use></svg> Baixar SVG</a>
      <button type="button" class="danger" data-action="new-code" data-id="${c.id}">Gerar novo código</button>
    </div>`;
  openModal('qrModal');
}

function printPoster(id) {
  const c = myCampaigns.find(x => x.id === id);
  const area = $('printArea');
  area.innerHTML = `<div class="poster">
    <p class="poster-brand">FoodFind</p>
    <h1>${escapeHtml(c.restaurantName)}</h1>
    <p class="poster-discount">${escapeHtml(c.discountLabel)}</p>
    <h2>${escapeHtml(c.title)}</h2>
    <p>${escapeHtml(c.description)}</p>
    <img src="${escapeHtml(c.qrUrl)}?v=${encodeURIComponent(c.updatedAt)}" alt="">
    <p class="poster-how">Aponte a câmera do celular para o QR Code, entre na sua conta FoodFind e mostre o voucher no caixa.</p>
    <p class="poster-code">Código: ${escapeHtml(c.codeFormatted)}</p>
    <p class="poster-valid">Válida de ${escapeHtml(fmtDateTime(c.startsAt))} até ${escapeHtml(fmtDateTime(c.endsAt))}${c.maxRedemptions ? ` · limitada a ${c.maxRedemptions} resgates` : ''}</p>
  </div>`;
  const img = area.querySelector('img');
  const go = () => setTimeout(() => window.print(), 100);
  if (img.complete) go(); else { img.onload = go; img.onerror = go; }
}

async function newCode(id) {
  const ok = await confirmDialog({ title: 'Gerar novo código', text: 'O QR Code e o código atuais deixarão de funcionar. Use esta opção se o código vazou. Será preciso imprimir o novo cartaz.', okLabel: 'Gerar novo código' });
  if (!ok) return;
  try {
    await apiFetch(`/api/my/campaigns/${id}/new-code`, { method: 'POST' });
    myCampaigns = (await apiFetch('/api/my/campaigns')).campaigns;
    renderCampaignAdmin();
    closeModal('qrModal');
    showQr(id);
    setStatus('Novo código gerado. Imprima o novo cartaz.', 'success');
  } catch (e) { setStatus(e.message, 'error'); }
}

async function campaignVouchers(id) {
  const c = myCampaigns.find(x => x.id === id);
  $('listBody').innerHTML = `<h2 id="listModalTitle">Vouchers: ${escapeHtml(c.title)}</h2>${stateBox('loading', 'Carregando...')}`;
  openModal('listModal');
  try {
    const { vouchers } = await apiFetch(`/api/my/campaigns/${id}/vouchers`);
    $('listBody').innerHTML = `<h2 id="listModalTitle">Vouchers: ${escapeHtml(c.title)}</h2>` + (vouchers.length
      ? `<div class="table-wrap"><table class="data-table"><caption class="sr-only">Vouchers emitidos</caption><thead><tr><th scope="col">Voucher</th><th scope="col">Cliente</th><th scope="col">Situação</th><th scope="col">Resgatado</th><th scope="col">Usado</th></tr></thead>
        <tbody>${vouchers.map(v => `<tr><td>${escapeHtml(v.voucher)}</td><td>${escapeHtml(v.client)}</td><td>${escapeHtml(v.statusLabel)}</td><td>${escapeHtml(fmtDateTime(v.redeemedAt))}</td><td>${escapeHtml(fmtDateTime(v.usedAt) || '—')}</td></tr>`).join('')}</tbody></table></div>`
      : stateBox('empty', 'Nenhum resgate ainda.'));
  } catch (e) { $('listBody').innerHTML = stateBox('error', e.message); }
}

async function lookupVoucher() {
  const number = $('vNumber').value.trim();
  const box = $('voucherResult');
  if (!number) return;
  box.innerHTML = stateBox('loading', 'Consultando...');
  try {
    const { voucher: v } = await apiFetch(`/api/my/vouchers/${encodeURIComponent(number)}`);
    const canUse = v.status === 'emitido' && !v.expired;
    box.innerHTML = `<div class="voucher-check-box ${canUse ? 'ok' : 'bad'}"><p><b>${escapeHtml(v.voucher)}</b> · ${escapeHtml(v.statusLabel)}</p>
      <p>${escapeHtml(v.restaurantName)} · ${escapeHtml(v.campaignTitle)} · <b>${escapeHtml(v.discountLabel)}</b></p>
      <p class="mut">Cliente: ${escapeHtml(v.client)} · resgatado em ${escapeHtml(fmtDateTime(v.redeemedAt))} · válido até ${escapeHtml(fmtDateTime(v.validUntil))}${v.usedAt ? ` · usado em ${escapeHtml(fmtDateTime(v.usedAt))}` : ''}</p>
      ${canUse ? `<button type="button" class="primary" data-action="use-voucher" data-number="${escapeHtml(v.voucher)}">Confirmar uso do voucher</button>` : ''}</div>`;
  } catch (e) { box.innerHTML = stateBox('error', e.message); }
}

async function useVoucher(number) {
  const box = $('voucherResult');
  const checkCode = $('vCheck').value.trim();
  if (!checkCode) { $('vCheck').focus(); box.insertAdjacentHTML('beforeend', '<p class="error-text" role="alert">Digite o código de conferência mostrado no comprovante do cliente.</p>'); return; }
  try {
    const data = await apiFetch(`/api/my/vouchers/${encodeURIComponent(number)}/use`, { method: 'POST', body: JSON.stringify({ checkCode }) });
    box.innerHTML = `<div class="voucher-check-box ok" role="status"><p><b><svg class="i" aria-hidden="true" focusable="false"><use href="#i-check"></use></svg> ${escapeHtml(data.message)}</b></p><p>${escapeHtml(data.voucher.voucher)} · ${escapeHtml(data.voucher.discountLabel)} · cliente ${escapeHtml(data.voucher.client)}</p></div>`;
    $('voucherForm').reset();
    myCampaigns = (await apiFetch('/api/my/campaigns')).campaigns;
    renderCampaignAdmin();
  } catch (e) { box.innerHTML = stateBox('error', e.message); }
}

// ----------------------------------------------------------------------------
// Minha conta (LGPD)
// ----------------------------------------------------------------------------
function openAccount() {
  showView('account');
  $('pName').value = me.name;
  $('pEmail').value = me.email;
  $('accountInfo').textContent = `Conta do tipo ${me.role === 'restaurante' ? 'Restaurante' : 'Cliente'}${me.isAdmin ? ' · administrador' : ''}.`;
  document.querySelectorAll('#view-account .form-msg').forEach(p => { p.textContent = ''; });
}

async function saveProfile(form) {
  const msg = form.querySelector('.form-msg');
  try {
    me = (await apiFetch('/api/me', { method: 'PUT', body: JSON.stringify({ name: $('pName').value }) })).user;
    renderAccount();
    msg.textContent = 'Nome atualizado.'; msg.className = 'form-msg ok-text';
  } catch (e) { msg.textContent = e.message; msg.className = 'form-msg error-text'; }
}

async function changePassword(form) {
  const msg = form.querySelector('.form-msg');
  try {
    const data = await apiFetch('/api/me/password', { method: 'POST', body: JSON.stringify({ currentPassword: $('pwdCurrent').value, newPassword: $('pwdNew').value }) });
    form.reset();
    msg.textContent = data.message; msg.className = 'form-msg ok-text';
  } catch (e) { msg.textContent = e.message; msg.className = 'form-msg error-text'; }
}

async function logoutAll() {
  const ok = await confirmDialog({ title: 'Sair de todos os dispositivos', text: 'Você será desconectado em todos os navegadores e celulares, inclusive neste.', okLabel: 'Sair de todos' });
  if (!ok) return;
  try {
    await apiFetch('/api/me/logout-all', { method: 'POST' });
    me = null; renderAccount();
    setStatus('Você saiu de todos os dispositivos.', 'success');
    location.hash = '#/';
  } catch (e) { setStatus(e.message, 'error'); }
}

async function deleteAccount() {
  const extra = `<div class="form-group"><label for="confirmPassword">Digite sua senha para confirmar</label><input id="confirmPassword" type="password" required autocomplete="current-password"></div>`;
  const text = me.role === 'restaurante'
    ? 'Isto apaga permanentemente sua conta, seus restaurantes, fotos, campanhas e vouchers emitidos, e encerra todas as sessões.'
    : 'Isto apaga permanentemente sua conta, suas avaliações e seus benefícios, e encerra todas as sessões.';
  let message = '';
  const ok = await confirmDialog({
    title: 'Excluir minha conta', text, okLabel: 'Excluir definitivamente', extra,
    onConfirm: async ({ password }) => { message = (await apiFetch('/api/me', { method: 'DELETE', body: JSON.stringify({ password }) })).message; }
  });
  if (!ok) return;
  me = null;
  renderAccount();
  setStatus(message, 'success');
  location.hash = '#/';
}

// ----------------------------------------------------------------------------
// Administração
// ----------------------------------------------------------------------------
// ---------------- Administração: visão geral e usuários ----------------
let adminUsersPage = 1;

function timeAgo(iso) {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 2) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d < 30 ? `há ${plural(d, 'dia', 'dias')}` : fmtDate(iso);
}

async function loadAdminStats() {
  const box = $('adminStats');
  box.innerHTML = stateBox('loading', 'Carregando números...');
  try {
    const { totals: t, days, persistent } = await apiFetch('/api/admin/stats');
    const tile = (n, label, sub = '') => `<li class="stat"><b>${n.toLocaleString('pt-BR')}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</li>`;
    const max = Math.max(1, ...days.map(d => d.visits));
    const dayLabel = d => d.day.slice(8, 10) + '/' + d.day.slice(5, 7);
    const last = days[days.length - 1];
    box.innerHTML = `${persistent ? '' : '<p class="notice">Os dados estão só no disco deste servidor. Em hospedagens gratuitas (ex.: Render) eles se perdem quando o servidor reinicia; configure DATABASE_URL para guardá-los num PostgreSQL.</p>'}
      <ul class="stats">
        ${tile(t.users, 'contas', `${t.clients} clientes · ${t.owners} restaurantes`)}
        ${tile(t.activeLast7Days, 'ativas nos últimos 7 dias')}
        ${tile(t.visits, 'visitas no total', `${last.visits} hoje`)}
        ${tile(t.restaurants, 'restaurantes cadastrados', t.pendingClaims ? `${t.pendingClaims} pedido(s) pendente(s)` : '')}
        ${tile(t.campaignsActive, 'campanhas ativas agora')}
        ${tile(t.redemptions, 'benefícios resgatados', `${t.vouchersUsed} usados no caixa`)}
        ${tile(t.reviews, 'avaliações')}
      </ul>
      <figure class="chart" aria-labelledby="chartCap">
        <figcaption id="chartCap">Visitas por dia nos últimos 14 dias (horário de São Paulo)</figcaption>
        <div class="bars" aria-hidden="true">${days.map(d => `<div class="bar-col" title="${dayLabel(d)}: ${plural(d.visits, 'visita', 'visitas')}, ${plural(d.signups, 'cadastro', 'cadastros')}"><span class="bar-n">${d.visits || ''}</span><span class="bar" data-h="${Math.round(d.visits / max * 100)}"></span><span class="bar-day">${dayLabel(d)}</span></div>`).join('')}</div>
        <details class="chart-data"><summary>Ver os números</summary>
          <table class="data-table"><thead><tr><th scope="col">Dia</th><th scope="col">Visitas</th><th scope="col">Cadastros</th><th scope="col">Resgates</th></tr></thead>
          <tbody>${days.slice().reverse().map(d => `<tr><td>${dayLabel(d)}</td><td>${d.visits}</td><td>${d.signups}</td><td>${d.redemptions}</td></tr>`).join('')}</tbody></table>
        </details>
      </figure>`;
    // Altura das barras via CSSOM (a CSP não permite atributos style no HTML).
    box.querySelectorAll('.bar').forEach(b => b.style.setProperty('--h', `${b.dataset.h}%`));
  } catch (e) { box.innerHTML = stateBox('error', e.message, '<button type="button" class="soft small" data-action="retry-route">Tentar de novo</button>'); }
}

async function loadAdminUsers(page = 1) {
  adminUsersPage = page;
  const box = $('adminUsers');
  box.innerHTML = stateBox('loading', 'Carregando usuários...');
  const params = new URLSearchParams({ page, limit: 25 });
  const q = $('adminUserQ').value.trim(), role = $('adminUserRole').value;
  if (q) params.set('q', q);
  if (role) params.set('role', role);
  try {
    const data = await apiFetch(`/api/admin/users?${params}`);
    if (!data.users.length) { box.innerHTML = stateBox('empty', q || role ? 'Nenhuma conta encontrada com esse filtro.' : 'Nenhuma conta cadastrada ainda.'); return; }
    const roleLabel = u => (u.role === 'restaurante' ? 'Restaurante' : 'Cliente') + (u.isAdmin ? ' · admin' : '');
    const extra = u => [u.restaurants && plural(u.restaurants, 'restaurante', 'restaurantes'), u.reviews && plural(u.reviews, 'avaliação', 'avaliações'), u.redemptions && plural(u.redemptions, 'benefício', 'benefícios')].filter(Boolean).join(' · ') || '—';
    box.innerHTML = `<p class="mut">${plural(data.total, 'conta encontrada', 'contas encontradas')}</p>
      <div class="table-wrap"><table class="data-table users-table">
        <thead><tr><th scope="col">Nome</th><th scope="col">E-mail</th><th scope="col">Tipo</th><th scope="col">Cadastro</th><th scope="col">Último acesso</th><th scope="col">Atividade</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead>
        <tbody>${data.users.map(u => `<tr>
          <td data-label="Nome"><b>${escapeHtml(u.name)}</b></td>
          <td data-label="E-mail"><a href="mailto:${escapeHtml(u.email)}">${escapeHtml(u.email)}</a></td>
          <td data-label="Tipo"><span class="status-badge role-${u.role}">${roleLabel(u)}</span></td>
          <td data-label="Cadastro">${escapeHtml(fmtDate(u.createdAt))}</td>
          <td data-label="Último acesso" title="${escapeHtml(fmtDateTime(u.lastSeenAt))}">${escapeHtml(timeAgo(u.lastSeenAt))}</td>
          <td data-label="Atividade" class="mut">${escapeHtml(extra(u))}</td>
          <td>${u.isAdmin ? '' : `<button type="button" class="soft small" data-action="reset-for" data-email="${escapeHtml(u.email)}">Redefinir senha</button>`}</td>
        </tr>`).join('')}</tbody></table></div>
      ${data.pages > 1 ? `<nav class="pager" aria-label="Páginas de usuários">
        <button type="button" class="soft small" data-action="admin-users-page" data-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>← Anteriores</button>
        <span>Página ${data.page} de ${data.pages}</span>
        <button type="button" class="soft small" data-action="admin-users-page" data-page="${data.page + 1}" ${data.page >= data.pages ? 'disabled' : ''}>Próximas →</button></nav>` : ''}`;
  } catch (e) { box.innerHTML = stateBox('error', e.message, '<button type="button" class="soft small" data-action="retry-route">Tentar de novo</button>'); }
}

async function openAdmin() {
  showView('admin');
  loadAdminStats();
  loadAdminUsers(adminUsersPage);
  const box = $('adminList');
  box.innerHTML = stateBox('loading', 'Carregando pedidos...');
  const status = $('adminFilter').value;
  try {
    const { claims } = await apiFetch(`/api/admin/claims${status ? `?status=${status}` : ''}`);
    const label = { pendente: 'Pendente', aprovado: 'Aprovado', recusado: 'Recusado' };
    box.innerHTML = (claims.length
      ? `<ul class="claim-list">${claims.map(c => `<li class="card-box"><div class="grow"><b>${escapeHtml(c.name)}</b> <span class="status-badge claim-${c.status}">${label[c.status]}</span>
          <br><span class="mut">${escapeHtml(c.address || 'Endereço não informado')} · <a href="${escapeHtml(c.osmUrl)}" target="_blank" rel="noopener noreferrer">ver no OpenStreetMap ↗</a></span>
          <br>Solicitante: <b>${escapeHtml(c.requester.name)}</b> (${escapeHtml(c.requester.email)})${c.phone ? ` · tel. informado: ${escapeHtml(c.phone)}` : ''}
          ${c.message ? `<br>Mensagem: <i>${escapeHtml(c.message)}</i>` : ''}
          <br><span class="mut">Enviado em ${escapeHtml(fmtDateTime(c.createdAt))}${c.decidedAt ? ` · analisado em ${escapeHtml(fmtDateTime(c.decidedAt))}` : ''}</span>
          ${c.reason ? `<br><span class="mut">Motivo: ${escapeHtml(c.reason)}</span>` : ''}</div>
          ${c.status === 'pendente' ? `<div class="my-actions"><button type="button" class="primary small" data-action="approve-claim" data-id="${c.id}">Aprovar</button><button type="button" class="danger small" data-action="reject-claim" data-id="${c.id}">Recusar</button></div>` : ''}</li>`).join('')}</ul>`
      : stateBox('empty', 'Nenhum pedido nesta situação.'))
      + `<form class="card-box admin-reset" data-form="admin-reset" aria-labelledby="resetTitle"><h2 id="resetTitle">Redefinir senha de um usuário</h2>
          <p class="mut">Use quando um usuário esquecer a senha (não há envio de e-mail). Uma senha temporária é gerada e as sessões dele são encerradas. Entregue a senha por um canal seguro e peça para trocá-la em "Minha conta".</p>
          <div class="inline"><label class="sr-only" for="resetEmail">E-mail do usuário</label><input id="resetEmail" type="email" required placeholder="e-mail do usuário"><button type="submit" class="soft">Gerar senha temporária</button></div>
          <p id="resetMsg" role="status"></p></form>`;
  } catch (e) { box.innerHTML = stateBox('error', e.message, '<button type="button" class="soft small" data-action="retry-route">Tentar de novo</button>'); }
}

async function decideClaim(id, approve) {
  let body = {};
  if (!approve) {
    const extra = '<div class="form-group"><label for="confirmReason">Motivo (o solicitante verá esta mensagem)</label><textarea id="confirmReason" rows="2" maxlength="300"></textarea></div>';
    const ok = await confirmDialog({ title: 'Recusar pedido', text: 'O restaurante continuará aparecendo com os dados do OpenStreetMap.', okLabel: 'Recusar', extra });
    if (!ok) return;
    body = { reason: ok.reason };
  }
  try {
    await apiFetch(`/api/admin/claims/${id}/${approve ? 'approve' : 'reject'}`, { method: 'POST', body: JSON.stringify(body) });
    setStatus(approve ? 'Pedido aprovado. O restaurante agora pertence ao solicitante.' : 'Pedido recusado.', 'success');
    openAdmin();
  } catch (e) { setStatus(e.message, 'error'); }
}

async function adminReset() {
  const msg = $('resetMsg');
  try {
    const data = await apiFetch('/api/admin/users/reset-password', { method: 'POST', body: JSON.stringify({ email: $('resetEmail').value.trim() }) });
    msg.innerHTML = `Senha temporária de <b>${escapeHtml(data.email)}</b>: <code class="temp-pass">${escapeHtml(data.temporaryPassword)}</code> (mostrada só agora).`;
    msg.className = 'ok-text';
  } catch (e) { msg.textContent = e.message; msg.className = 'error-text'; }
}

// ----------------------------------------------------------------------------
// Eventos (delegação)
// ----------------------------------------------------------------------------
const actions = {
  skip: () => { const m = $('main'); m.focus(); m.scrollIntoView(); },
  login: () => openAuth('login'),
  register: () => openAuth('register'),
  'register-owner': () => openAuth('register', { role: 'restaurante' }),
  'login-review': () => { pendingAfterLogin = () => route(); openAuth('login', { notice: 'Entre como cliente para avaliar.' }); },
  logout,
  'auth-tab': el => switchTab(el.dataset.mode),
  'toggle-password': togglePassword,
  'close-modal': el => { const m = el.closest('[data-modal]'); if (m) closeModal(m.id); },
  scan: () => openScanner(),
  'scan-start': startScan,
  locate: useMyLocation,
  'geo-allow': () => { store('ff_geo_consent', 'sim'); $('geoBanner').classList.add('hide'); useMyLocation(); },
  'geo-deny': () => { store('ff_geo_consent', 'nao'); $('geoBanner').classList.add('hide'); $('addr').focus(); },
  'pick-address': el => pickAddress(Number(el.dataset.i)),
  'clear-filters': clearFilters,
  'admin-users-page': el => loadAdminUsers(Number(el.dataset.page)),
  'reset-for': el => { const i = $('resetEmail'); if (!i) return; i.value = el.dataset.email; i.closest('form').scrollIntoView({ behavior: 'smooth', block: 'center' }); i.focus({ preventScroll: true }); },
  'cat-toggle': el => setChip(el, el.getAttribute('aria-pressed') !== 'true'),
  'cat-all': () => { if (!$('fCategory').value) return; clearChips(); loadRestaurants(); },
  'search-area': searchThisArea,
  'view-mode': el => setViewMode(el.dataset.mode),
  'retry-search': () => loadRestaurants(),
  'retry-route': () => route(),
  more: () => { visibleCount += PAGE_SIZE; renderList(); },
  'set-cover': el => { $('detailCover').src = el.dataset.src; document.querySelectorAll('.gallery .thumb').forEach(t => t.classList.toggle('active', t === el)); },
  claim: claimRestaurant,
  'edit-restaurant': el => editRestaurant(Number(el.dataset.id)),
  'delete-restaurant': el => deleteRestaurant(Number(el.dataset.id)),
  'new-restaurant': () => fillForm({}),
  'cancel-edit': cancelEdit,
  'cancel-claim': el => cancelClaim(Number(el.dataset.id)),
  'geocode-form': geocodeForm,
  'pick-form-address': el => { const r = $('geoResults')._results[Number(el.dataset.i)]; setFormLocation(r.lat, r.lng, 17); $('geoResults').classList.add('hide'); },
  'locate-form': useMyLocationForForm,
  'copy-hours': copyFirstDay,
  'add-menu-item': () => addMenuItem(),
  'remove-menu-item': el => { el.closest('.menu-row').remove(); refreshSections(); },
  'make-cover': el => { editing.photos.unshift(editing.photos.splice(Number(el.dataset.i), 1)[0]); renderPhotos(); },
  'remove-photo': el => { editing.photos.splice(Number(el.dataset.i), 1); renderPhotos(); },
  'review-page': el => { if (!el.disabled && currentDetail) loadReviews(currentDetail.id, Number(el.dataset.page)); },
  'edit-review': () => { const box = $('reviewFormBox'); box.innerHTML = reviewFormHtml(box._mine); box.querySelector('input:checked, input').focus(); },
  'cancel-review': () => loadReviews(currentDetail.id, reviewPage),
  'delete-review': deleteReview,
  // Atalho "Avaliar restaurante": leva à seção de avaliações e foca a nota (ou pede o login certo).
  'goto-review': () => {
    if (!me) { pendingAfterLogin = () => { route(); setTimeout(() => actions['goto-review'](), 600); }; openAuth('login', { notice: 'Entre como cliente para avaliar este restaurante.' }); return; }
    if (me.role !== 'cliente') { setStatus('Contas do tipo Restaurante não avaliam restaurantes. Entre com uma conta de cliente.', 'error'); return; }
    const box = $('reviewFormBox');
    if (!box) return;
    if (box._mine && !box.querySelector('form')) box.innerHTML = reviewFormHtml(box._mine);
    $('revTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
    const first = box.querySelector('input[name=rating]:checked, input[name=rating]');
    if (first) first.focus({ preventScroll: true });
  },
  'show-voucher': el => showVoucher(myVouchers[Number(el.dataset.i)]),
  'new-campaign': newCampaign,
  'cancel-campaign': () => { $('cForm').classList.add('hide'); editingCampaign = null; },
  'edit-campaign': el => fillCampaignForm(myCampaigns.find(c => c.id === Number(el.dataset.id))),
  'toggle-campaign': el => toggleCampaign(Number(el.dataset.id)),
  'delete-campaign': el => deleteCampaign(Number(el.dataset.id)),
  'show-qr': el => showQr(Number(el.dataset.id)),
  'print-qr': el => printPoster(Number(el.dataset.id)),
  'new-code': el => newCode(Number(el.dataset.id)),
  'copy-link': async () => {
    const input = $('qrLink');
    try { await navigator.clipboard.writeText(input.value); setStatus('Link copiado.', 'success'); }
    catch { input.select(); setStatus('Selecione e copie o link (Ctrl+C).'); }
  },
  'campaign-vouchers': el => campaignVouchers(Number(el.dataset.id)),
  'use-voucher': el => useVoucher(el.dataset.number),
  'logout-all': logoutAll,
  'delete-account': deleteAccount,
  'approve-claim': el => decideClaim(Number(el.dataset.id), true),
  'reject-claim': el => decideClaim(Number(el.dataset.id), false)
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  if (el.tagName !== 'A' || el.dataset.action !== 'close-modal') e.preventDefault();
  // Fecha o menu da conta ao escolher uma opção.
  const menu = el.closest('details.user-menu');
  if (menu) menu.open = false;
  fn(el, e);
});

document.addEventListener('click', e => {
  const link = e.target.closest('.user-menu a');
  if (link) link.closest('details').open = false;
  const open = document.querySelector('details.user-menu[open]');
  if (open && !open.contains(e.target)) open.open = false;
});

const forms = {
  search: () => { areaRadius = null; loadRestaurants(); },
  address: searchAddress,
  filters: () => loadRestaurants(),
  login: handleLogin,
  register: handleRegister,
  restaurant: saveRestaurant,
  review: f => submitReview(f),
  redeem: () => redeem($('redeemCode').value),
  campaign: saveCampaign,
  'voucher-lookup': lookupVoucher,
  profile: f => saveProfile(f),
  password: f => changePassword(f),
  'admin-reset': adminReset,
  'admin-users': () => loadAdminUsers(1),
  confirm: async f => {
    const st = confirmState;
    if (!st) return;
    const pw = f.querySelector('#confirmPassword');
    if (pw && !pw.value) { confirmError('Digite sua senha.'); pw.focus(); return; }
    const reason = f.querySelector('#confirmReason');
    const values = { password: pw ? pw.value : undefined, reason: reason ? reason.value : undefined };
    if (st.onConfirm) {
      const ok = $('confirmOk');
      ok.disabled = true;
      try { await st.onConfirm(values); }
      catch (e) { confirmError(e.message); ok.disabled = false; return; }
      ok.disabled = false;
    }
    confirmState = null;
    closeModal('confirmModal');
    st.resolve(values);
  }
};

document.addEventListener('submit', e => {
  const name = e.target.dataset.form;
  if (!name || !forms[name]) return;
  e.preventDefault();
  forms[name](e.target);
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.closest('#filtersForm')) { if (t.name === 'radius') areaRadius = null; loadRestaurants(); }
  else if (t.matches('.hours-row input[type=checkbox]')) t.closest('.hours-row').classList.toggle('is-closed', t.checked);
  else if (t.matches('.m-section')) refreshSections();
  else if (t.id === 'photoInput') uploadPhotos(t);
  else if (t.id === 'adminFilter') openAdmin();
});

['mouseover', 'focusin'].forEach(type => document.addEventListener(type, e => {
  const item = e.target.closest && e.target.closest('#list a.item');
  if (item) highlightMarker(item.dataset.id);
}));
['mouseout', 'focusout'].forEach(type => document.addEventListener(type, e => {
  const item = e.target.closest && e.target.closest('#list a.item');
  if (item && !item.contains(e.relatedTarget)) highlightMarker(null);
}));

document.addEventListener('input', e => {
  if (e.target.id === 'reviewComment') $('reviewCount').textContent = `${e.target.value.length}/600 caracteres`;
  else if (e.target.id === 'regPassword') updatePwMeter();
});

// ----------------------------------------------------------------------------
// Início
// ----------------------------------------------------------------------------
// Título do topo entra letra a letra (como no demo do "Background Paths" da Kokonut UI no 21st.dev)
// e "por perto?" ganha um traço desenhado à mão. Leitores de tela recebem o texto inteiro.
function animateHeroTitle() {
  const h1 = $('homeTitle');
  if (!h1 || h1.dataset.animated) return;
  h1.dataset.animated = '1';
  const em = h1.querySelector('em');
  if (em) em.insertAdjacentHTML('beforeend', '<svg class="scribble" viewBox="0 0 300 24" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="M4 16 C 60 6, 120 4, 180 10 S 270 20, 296 8"/></svg>');
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const full = h1.textContent.trim();
  let word = 0, letter = 0;
  const split = node => {
    const frag = document.createDocumentFragment();
    node.textContent.split(/(\s+)/).forEach(part => {
      if (!part) return;
      if (/^\s+$/.test(part)) { frag.append(' '); return; }
      const w = document.createElement('span');
      w.className = 'w';
      for (const ch of part) {
        const c = document.createElement('span');
        c.className = 'ch';
        c.textContent = ch;
        c.style.setProperty('--d', `${(word * 0.07 + letter * 0.022).toFixed(3)}s`);
        w.append(c); letter++;
      }
      frag.append(w); word++;
    });
    return frag;
  };
  const visual = document.createElement('span');
  visual.setAttribute('aria-hidden', 'true');
  for (const node of [...h1.childNodes]) {
    if (node.nodeType === Node.TEXT_NODE) visual.append(split(node));
    else if (node.nodeName === 'EM') {
      const e = document.createElement('em');
      for (const sub of [...node.childNodes]) e.append(sub.nodeType === Node.TEXT_NODE ? split(sub) : sub);
      visual.append(e);
    }
  }
  const sr = document.createElement('span');
  sr.className = 'sr-only';
  sr.textContent = full;
  h1.replaceChildren(sr, visual);
  h1.classList.add('is-animating');
}

async function boot() {
  $('appVersion').textContent = APP_VERSION;
  // Link do QR Code: /?resgatar=CODIGO. Guarda o código e limpa a URL.
  const params = new URLSearchParams(location.search);
  if (params.get('resgatar')) {
    session('ff_pending_redeem', params.get('resgatar'));
    history.replaceState(null, '', `${location.pathname}${location.hash}`);
  }
  // No celular, os filtros começam recolhidos para a lista aparecer antes.
  if (window.matchMedia && window.matchMedia('(max-width: 900px)').matches) $('filtersBox').open = false;
  renderChips();
  // Conta a visita (só o total do dia, sem identificar ninguém), uma vez por aba.
  if (!session('ff_visit')) { session('ff_visit', '1'); apiFetch('/api/visit', { method: 'POST', body: '{}' }).catch(() => {}); }
  // Cabeçalho flutuante ganha sombra quando a página rola.
  const onScroll = () => document.body.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  animateHeroTitle();
  // Fundo da página: fita de linhas (Background Paths). Sem canvas, fica o creme liso.
  if (window.FoodFindFluxo) { try { window.FoodFindFluxo($('pageFx')); } catch { /* fundo liso continua */ } }
  // Fundo animado do topo (Glass Fold, GradFlow/MIT). Sem WebGL, fica o fundo em CSS.
  if (window.FoodFindGlassFold) { try { window.FoodFindGlassFold($('heroFx')); } catch { /* fundo em CSS continua */ } }
  initMap();
  try { me = (await apiFetch('/api/auth/me')).user; } catch { me = null; }
  renderAccount();
  route();
  if (geoConsent() === 'sim') useMyLocation();
  else {
    if (!geoConsent()) $('geoBanner').classList.remove('hide');
    loadRestaurants();
  }
  processPendingRedeem();

  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

boot();
