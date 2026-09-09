let map, markers = [], userMarker = null, userLocation = null, currentRestaurants = [];
const $ = x => document.getElementById(x);

map = L.map('map').setView([-23.5613, -46.6565], 14);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

function setStatus(text='', kind='') { $('status').textContent = text; $('status').className = `status ${kind}`; }
function account() { return JSON.parse(localStorage.getItem('foodfind_user') || 'null'); }
function renderAccount() {
  const u = account();
  $('accountArea').innerHTML = u
    ? `<span class="user">Olá, ${escapeHtml(u.name.split(' ')[0])}</span><button class="account-btn" onclick="logout()">Sair</button>`
    : `<button class="account-btn" onclick="openAuth('login')">Entrar</button><button class="account-btn filled" onclick="openAuth('register')">Criar conta</button>`;
}
function escapeHtml(s='') { return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function openAuth(mode='login') {
  $('authModal').classList.remove('hide'); document.body.style.overflow='hidden';
  $('authContent').innerHTML = mode === 'register' ? registerForm() : loginForm();
}
function closeAuth() { $('authModal').classList.add('hide'); document.body.style.overflow=''; }
function initAuthModal() {
  const modal = $('authModal');
  $('closeAuthBtn').addEventListener('click', closeAuth);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeAuth(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.classList.contains('hide')) closeAuth(); });
}

function loginForm() { return `<h2>Entrar no FoodFind</h2><p class="mut">Acesse sua conta para continuar.</p><label>E-mail<input id="email" type="email" placeholder="voce@email.com"></label><label>Senha<input id="password" type="password" placeholder="••••••••"></label><button class="primary full" onclick="login()">Entrar</button><p class="switch">Ainda não tem conta? <button onclick="openAuth('register')">Criar conta</button></p>`; }
function registerForm() { return `<h2>Criar conta</h2><p class="mut">Cadastre-se para usar o FoodFind.</p><label>Nome<input id="name" placeholder="Seu nome"></label><label>E-mail<input id="email" type="email" placeholder="voce@email.com"></label><label>Senha<input id="password" type="password" placeholder="Mínimo 6 caracteres"></label><button class="primary full" onclick="register()">Criar conta</button><p class="switch">Já possui conta? <button onclick="openAuth('login')">Entrar</button></p>`; }
function register() {
  const name=$('name').value.trim(), email=$('email').value.trim(), password=$('password').value;
  if(!name || !email || password.length<6) return alert('Preencha nome, e-mail e uma senha com pelo menos 6 caracteres.');
  localStorage.setItem('foodfind_account', JSON.stringify({name,email,password}));
  localStorage.setItem('foodfind_user', JSON.stringify({name,email}));
  closeAuth(); renderAccount(); setStatus(`Conta criada. Bem-vindo(a), ${name.split(' ')[0]}!`, 'success');
}
function login() {
  const email=$('email').value.trim(), password=$('password').value, saved=JSON.parse(localStorage.getItem('foodfind_account')||'null');
  if(saved && saved.email===email && saved.password===password) { localStorage.setItem('foodfind_user', JSON.stringify({name:saved.name,email:saved.email})); closeAuth(); renderAccount(); setStatus(`Login realizado. Bem-vindo(a), ${saved.name.split(' ')[0]}!`, 'success'); }
  else alert('Conta não encontrada ou senha incorreta. Se ainda não cadastrou, clique em Criar conta.');
}
function logout(){localStorage.removeItem('foodfind_user');renderAccount();setStatus('Você saiu da conta.');}

function useMyLocation() {
  if (!navigator.geolocation) return setStatus('Seu navegador não oferece geolocalização.', 'error');
  setStatus('Solicitando sua localização...');
  navigator.geolocation.getCurrentPosition(pos => {
    userLocation = {lat: pos.coords.latitude, lng: pos.coords.longitude};
    map.setView([userLocation.lat,userLocation.lng],15);
    if(userMarker) map.removeLayer(userMarker);
    userMarker = L.circleMarker([userLocation.lat,userLocation.lng], {radius:9}).addTo(map).bindPopup('📍 Você está aqui').openPopup();
    setStatus('Localização encontrada. Buscando restaurantes reais próximos...', 'success');
    loadRestaurants();
  }, err => {
    const msg = err.code===1 ? 'Permissão de localização negada. Libere a localização do navegador e tente novamente.' : 'Não foi possível obter sua localização.';
    setStatus(msg,'error');
  }, {enableHighAccuracy:true, timeout:10000, maximumAge:60000});
}

async function loadRestaurants() {
  const q=$('q').value.trim();
  const loc=userLocation || {lat:-23.5613,lng:-46.6565};
  setStatus('Consultando restaurantes reais próximos...');
  try {
    const response=await fetch(`/api/restaurants?lat=${loc.lat}&lng=${loc.lng}&q=${encodeURIComponent(q)}`);
    const data=await response.json();
    if(!response.ok) throw new Error(data.message || 'Falha na consulta');
    currentRestaurants=data.restaurants||[];
    $('count').textContent=`(${currentRestaurants.length})`;
    $('list').innerHTML=currentRestaurants.length ? currentRestaurants.map(card).join('') : '<p class="mut">Nenhum estabelecimento encontrado. Tente outra busca.</p>';
    markers.forEach(m=>map.removeLayer(m));
    markers=currentRestaurants.map(r=>L.marker([r.lat,r.lng]).addTo(map).bindPopup(`<b>${escapeHtml(r.name)}</b><br>${r.distance}<br><button onclick="openR('${r.id}')">Ver perfil</button>`));
    if(!userLocation && currentRestaurants.length) map.fitBounds(L.latLngBounds(currentRestaurants.map(r=>[r.lat,r.lng])).pad(.15));
    setStatus(`Fonte: OpenStreetMap • ${currentRestaurants.length} estabelecimento(s) encontrado(s).`,'success');
  } catch(e) { console.error(e); $('list').innerHTML='<p class="mut">Não foi possível carregar os restaurantes agora. Verifique sua internet e tente novamente.</p>'; setStatus(e.message,'error'); }
}
function card(r) {
  const rating=r.rating ? `★ ${r.rating}` : '☆ Sem avaliação';
  const image = r.category==='Café' ? '☕' : r.category==='Fast-food' ? '🍔' : '🍽️';
  return `<article class="item" onclick="openR('${r.id}')"><div class="food-icon">${image}</div><div><h3>${escapeHtml(r.name)}</h3><div class="mut">${escapeHtml(r.category)}</div><div class="rating">${rating}</div><div class="mut">📍 ${escapeHtml(r.distance)}</div></div></article>`;
}
function findR(id){return currentRestaurants.find(r=>String(r.id)===String(id));}
function openR(id){
  const r=findR(id); if(!r)return;
  $('detail').className='detail';
  const rating=r.rating ? `★ ${r.rating}` : '☆ Sem avaliação cadastrada';
  const website=r.website ? `<a class="primary-link" href="${escapeHtml(r.website)}" target="_blank" rel="noopener">🌐 Site do estabelecimento ↗</a>` : '<span class="mut">Site não informado</span>';
  $('detail').innerHTML=`<button class="back" onclick="home()">← Voltar</button><div class="detail-card"><div class="detail-cover">🍽️</div><div class="body"><small>${escapeHtml(r.category).toUpperCase()}</small><h1>${escapeHtml(r.name)}</h1><p>${escapeHtml(r.description)}</p><div class="pills"><span class="pill">${rating}</span><span class="pill">📍 ${escapeHtml(r.address)}</span><span class="pill">📞 ${escapeHtml(r.phone)}</span><span class="pill">🕐 ${escapeHtml(r.hours)}</span></div><div class="cols"><div><h2>Informações</h2><p>Distância: <b>${escapeHtml(r.distance)}</b></p><p>${website}</p><p class="mut">Dados públicos do OpenStreetMap. Algumas informações podem não estar cadastradas.</p></div><div><h2>🍽️ Cardápio</h2><p class="mut">O cardápio não está disponível nos dados públicos deste estabelecimento.</p><p>O FoodFind não processa pedidos. Quando houver site informado, o usuário pode acessar o estabelecimento por lá.</p></div></div></div></div>`;
  $('homeGrid').classList.add('hide'); document.querySelector('.search').classList.add('hide'); document.querySelector('.hero').classList.add('hide'); scrollTo(0,0);
}
function home(){ $('detail').className='hide'; $('homeGrid').classList.remove('hide'); document.querySelector('.search').classList.remove('hide'); document.querySelector('.hero').classList.remove('hide'); setTimeout(()=>map.invalidateSize(),50); }

renderAccount();
initAuthModal();
loadRestaurants();
