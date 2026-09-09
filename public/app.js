let map, markers = [], userMarker = null, userLocation = null, currentRestaurants = [];
const $ = x => document.getElementById(x);

map = L.map('map').setView([-23.5613, -46.6565], 14);
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>', subdomains: 'abcd', maxZoom: 20
}).addTo(map);

function setStatus(text='', kind='') { $('status').textContent = text; $('status').className = `status ${kind}`; }
function getLoggedInUser() { return JSON.parse(localStorage.getItem('foodfind_logged_user') || 'null'); }
function getUsersDB() { return JSON.parse(localStorage.getItem('foodfind_users_db') || '[]'); }

function renderAccount() {
  const u = getLoggedInUser();
  $('accountArea').innerHTML = u
    ? `<span class="user">Olá, ${escapeHtml(u.name.split(' ')[0])}</span><button class="account-btn" onclick="logout()">Sair</button>`
    : `<button class="account-btn" onclick="openAuthModal('login')">Entrar</button>
       <button class="account-btn primary-btn" onclick="openAuthModal('register')">Criar conta</button>`;
}

function escapeHtml(s='') { return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* --- Modal & Auth Logic --- */
function openAuthModal(mode = 'login') {
  clearAuthError();
  switchTab(mode);
  $('authModal').classList.remove('hide');
}

function closeAuthModal() {
  $('authModal').classList.add('hide');
  clearAuthError();
}

function handleOverlayClick(e) {
  if (e.target.id === 'authModal') closeAuthModal();
}

function clearAuthError() {
  const errEl = $('modalError');
  if (errEl) { errEl.textContent = ''; errEl.classList.add('hide'); }
}

function showAuthError(msg) {
  let errEl = $('modalError');
  if (!errEl) {
    errEl = document.createElement('div');
    errEl.id = 'modalError';
    errEl.className = 'modal-error';
    const content = document.querySelector('.modal-content');
    content.insertBefore(errEl, content.children[2]);
  }
  errEl.textContent = msg;
  errEl.classList.remove('hide');
}

function switchTab(mode) {
  clearAuthError();
  if (mode === 'login') {
    $('tabLogin').classList.add('active');
    $('tabRegister').classList.remove('active');
    $('formLogin').classList.remove('hide');
    $('formRegister').classList.add('hide');
  } else {
    $('tabRegister').classList.add('active');
    $('tabLogin').classList.remove('active');
    $('formRegister').classList.remove('hide');
    $('formLogin').classList.add('hide');
  }
}

function handleRegister(e) {
  e.preventDefault();
  const name = $('regName').value.trim();
  const email = $('regEmail').value.trim().toLowerCase();
  const password = $('regPassword').value;

  const users = getUsersDB();
  const existingUser = users.find(u => u.email === email);

  if (existingUser) {
    showAuthError('Este e-mail já está cadastrado. Por favor, faça login.');
    return;
  }

  const newUser = { name, email, password };
  users.push(newUser);
  localStorage.setItem('foodfind_users_db', JSON.stringify(users));
  localStorage.setItem('foodfind_logged_user', JSON.stringify(newUser));

  renderAccount();
  closeAuthModal();
  
  // Clear forms
  $('formRegister').reset();
  $('formLogin').reset();

  setStatus(`Conta criada com sucesso! Olá, ${newUser.name}.`, 'success');
}

function handleLogin(e) {
  e.preventDefault();
  const email = $('loginEmail').value.trim().toLowerCase();
  const password = $('loginPassword').value;

  const users = getUsersDB();
  const user = users.find(u => u.email === email);

  if (!user) {
    showAuthError('E-mail não cadastrado. É necessário criar uma conta primeiro.');
    setTimeout(() => {
      switchTab('register');
      $('regEmail').value = email;
    }, 1800);
    return;
  }

  if (user.password !== password) {
    showAuthError('Senha incorreta. Tente novamente.');
    return;
  }

  // Se o e-mail estiver cadastrado e a senha estiver correta:
  // 1. Salva o usuário logado
  localStorage.setItem('foodfind_logged_user', JSON.stringify(user));
  // 2. Atualiza o cabeçalho/status de usuário logado
  renderAccount();
  // 3. Fecha o pop-up
  closeAuthModal();
  
  $('formLogin').reset();
  setStatus(`Bem-vindo(a) de volta, ${user.name}!`, 'success');
}

function logout(){ 
  localStorage.removeItem('foodfind_logged_user'); 
  renderAccount(); 
  setStatus('Você saiu da conta.'); 
}

/* --- Map & Location Logic --- */
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
    if(!userLocation && currentRestaurants.length) map.fitBounds(L.latLngBounds(currentRestaurants.map(r=>[r.lat,r.lng])).pad(.15)); setTimeout(() => map.invalidateSize(), 200);
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
loadRestaurants();
