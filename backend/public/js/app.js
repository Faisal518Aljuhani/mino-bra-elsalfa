// ===================== حالة عامة =====================
let socket = null;
let currentUser = null; // { id, username }
let currentRoom = null; // آخر room_update
let mySpyStatus = null;
let currentRoomCode = null;

const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove('hidden');
const hide = (id) => $(id).classList.add('hidden');

function getToken() { return localStorage.getItem('token'); }
function setToken(t) { localStorage.setItem('token', t); }
function clearToken() { localStorage.removeItem('token'); }

// ===================== شاشة البداية: اختيار الوضع =====================
$('btn-mode-online').addEventListener('click', () => {
  hide('view-home');
  show('view-auth');
});
$('btn-mode-local').addEventListener('click', () => {
  hide('view-home');
  if (typeof startLocalMode === 'function') startLocalMode();
});
$('btn-mode-cf').addEventListener('click', () => {
  hide('view-home');
  if (typeof startCommonFactorMode === 'function') startCommonFactorMode();
});
$('btn-auth-back-home').addEventListener('click', () => {
  hide('view-auth');
  show('view-home');
});

// ===================== تبويبات تسجيل الدخول / حساب جديد =====================
$('tab-login').addEventListener('click', () => {
  $('tab-login').classList.add('active');
  $('tab-register').classList.remove('active');
  show('form-login'); hide('form-register'); hide('form-forgot');
  $('auth-message').innerHTML = '';
});
$('tab-register').addEventListener('click', () => {
  $('tab-register').classList.add('active');
  $('tab-login').classList.remove('active');
  show('form-register'); hide('form-login'); hide('form-forgot');
  $('auth-message').innerHTML = '';
});
$('btn-forgot').addEventListener('click', () => {
  hide('form-login'); hide('form-register'); show('form-forgot');
  $('auth-message').innerHTML = '';
});
$('btn-back-login').addEventListener('click', () => {
  hide('form-forgot'); show('form-login');
  $('auth-message').innerHTML = '';
});

// ===================== تسجيل حساب جديد =====================
$('form-register').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('reg-username').value.trim();
  const email = $('reg-email').value.trim();
  const password = $('reg-password').value;

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'حدث خطأ');
    $('auth-message').innerHTML = `<div class="success-box">${data.message}</div>`;
    $('form-register').reset();
  } catch (err) {
    $('auth-message').innerHTML = `<div class="error-box">${err.message}</div>`;
  }
});

// ===================== تسجيل الدخول =====================
$('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('login-email').value.trim();
  const password = $('login-password').value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'حدث خطأ');
    setToken(data.token);
    currentUser = { username: data.username };
    enterApp();
  } catch (err) {
    $('auth-message').innerHTML = `<div class="error-box">${err.message}</div>`;
  }
});

// ===================== نسيت كلمة المرور =====================
$('form-forgot').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('forgot-email').value.trim();
  try {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    $('auth-message').innerHTML = `<div class="success-box">${data.message}</div>`;
  } catch (err) {
    $('auth-message').innerHTML = `<div class="error-box">حدث خطأ</div>`;
  }
});

// ===================== الدخول للتطبيق بعد تسجيل الدخول =====================
function enterApp() {
  hide('view-home');
  hide('view-auth');
  show('view-lobby');
  $('user-badge').textContent = currentUser.username;
  connectSocket();
}

function connectSocket() {
  socket = io({ auth: { token: getToken() } });

  socket.on('connect_error', (err) => {
    if (err.message === 'جلسة غير صالحة' || err.message === 'غير مصرح') {
      clearToken();
      location.reload();
    }
  });

  socket.on('room_created', (room) => { onRoomUpdate(room); });
  socket.on('room_update', (room) => { onRoomUpdate(room); });
  socket.on('error_msg', (msg) => alert(msg));

  socket.on('game_started', ({ category, word, isSpy }) => {
    mySpyStatus = isSpy;
    hide('view-lobby'); hide('view-voting'); hide('view-results');
    show('view-playing');

    $('category-display').textContent = 'الفئة: ' + category;
    const card = $('secret-card');
    if (isSpy) {
      card.classList.add('is-spy');
      $('role-label').textContent = 'أنت برا السالفة 🕵️';
      $('word-display').textContent = '؟ ما تعرف الكلمة، حاول تتصرف طبيعي';
    } else {
      card.classList.remove('is-spy');
      $('role-label').textContent = 'أنت داخل السالفة';
      $('word-display').textContent = word;
    }

    if (currentRoom && currentRoom.hostId === getMyId()) {
      show('host-voting-control');
    } else {
      hide('host-voting-control');
    }
  });

  socket.on('vote_progress', ({ votedCount, total }) => {
    $('vote-progress-note').textContent = `صوّت ${votedCount} من ${total} لاعبين`;
  });

  socket.on('game_results', (result) => {
    hide('view-playing'); hide('view-voting');
    show('view-results');
    renderResults(result);
  });

  socket.emit('get_categories');
  socket.on('categories_list', (cats) => {
    const sel = $('category-select');
    cats.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      sel.appendChild(opt);
    });
  });
}

function getMyId() {
  // نستخرج id المستخدم من التوكن (JWT) محلياً بدون مكتبة خارجية
  try {
    const token = getToken();
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.id;
  } catch (e) { return null; }
}

// ===================== إنشاء / الانضمام لغرفة =====================
$('btn-create-room').addEventListener('click', () => {
  socket.emit('create_room');
});

$('btn-join-room').addEventListener('click', () => {
  const code = $('join-code').value.trim().toUpperCase();
  if (!code) return alert('اكتب كود الغرفة');
  socket.emit('join_room', { roomCode: code });
});

function onRoomUpdate(room) {
  currentRoom = room;
  currentRoomCode = room.code;

  hide('view-playing'); hide('view-voting'); hide('view-results');
  show('view-lobby');
  hide('lobby-choice');
  show('lobby-room');

  $('room-code-display').textContent = room.code;

  const list = $('players-list');
  list.innerHTML = '';
  room.players.forEach(p => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="dot"></span> ${p.username}` + (p.id === room.hostId ? `<span class="host-badge">المضيف</span>` : '');
    list.appendChild(li);
  });

  const isHost = room.hostId === getMyId();
  if (room.state === 'lobby') {
    if (isHost) { show('host-controls'); hide('waiting-note'); }
    else { hide('host-controls'); show('waiting-note'); }
  }

  if (room.state === 'voting') {
    hide('view-lobby'); show('view-voting');
    renderVoteGrid(room, isHost);
  }
}

// ===================== بدء اللعبة =====================
$('btn-start-game').addEventListener('click', () => {
  const chosenCategory = $('category-select').value;
  socket.emit('start_game', { roomCode: currentRoomCode, chosenCategory });
});

$('btn-start-voting').addEventListener('click', () => {
  socket.emit('start_voting', { roomCode: currentRoomCode });
});

// ===================== التصويت =====================
function renderVoteGrid(room, isHost) {
  const grid = $('vote-grid');
  grid.innerHTML = '';
  const myId = getMyId();
  room.players.forEach(p => {
    if (String(p.id) === String(myId)) return; // ما تصوت لنفسك
    const div = document.createElement('div');
    div.className = 'vote-option';
    div.textContent = p.username;
    div.addEventListener('click', () => {
      document.querySelectorAll('.vote-option').forEach(el => el.classList.remove('selected'));
      div.classList.add('selected');
      socket.emit('cast_vote', { roomCode: currentRoomCode, suspectId: p.id });
    });
    grid.appendChild(div);
  });
  $('vote-progress-note').textContent = '';
}

// ===================== النتائج =====================
function renderResults(result) {
  const spyPlayer = currentRoom.players.find(p => String(p.id) === String(result.spyId));
  const accusedPlayer = currentRoom.players.find(p => String(p.id) === String(result.accusedId));

  $('results-content').innerHTML = `
    <div class="secret-card ${result.spyCaught ? '' : 'is-spy'}">
      <div class="role-label">${result.spyCaught ? '✅ تم كشف الجاسوس' : '❌ الجاسوس نجا'}</div>
      <div class="category-name">الفئة: ${result.category}</div>
      <div class="the-word">الكلمة: ${result.word}</div>
    </div>
    <p class="center-note" style="margin-top:16px;">
      الشخص المتهم بأغلب الأصوات: <b>${accusedPlayer ? accusedPlayer.username : '—'}</b><br>
      الجاسوس الحقيقي كان: <b>${spyPlayer ? spyPlayer.username : '—'}</b>
    </p>
  `;

  const isHost = currentRoom.hostId === getMyId();
  if (isHost) { show('host-again-control'); hide('guest-again-note'); }
  else { hide('host-again-control'); show('guest-again-note'); }
}

$('btn-play-again').addEventListener('click', () => {
  socket.emit('play_again', { roomCode: currentRoomCode });
});

// ===================== القائمة الجانبية (همبرغر) =====================
const ALL_TOP_VIEWS = [
  'view-home', 'view-auth',
  'view-local-setup', 'view-local-reveal', 'view-local-play', 'view-local-voting', 'view-local-results',
  'view-cf-play', 'view-cf-results',
  'view-lobby', 'view-playing', 'view-voting', 'view-results'
];

function hideAllTopViews() {
  ALL_TOP_VIEWS.forEach(hide);
}

function navigateTo(target) {
  hideAllTopViews();
  if (target === 'home') {
    show('view-home');
  } else if (target === 'online') {
    if (currentUser) { enterApp(); } else { show('view-auth'); }
  } else if (target === 'local') {
    if (typeof startLocalMode === 'function') startLocalMode();
  } else if (target === 'cf') {
    if (typeof startCommonFactorMode === 'function') startCommonFactorMode();
  }
  closeMenu();
}

function openMenu() {
  $('side-menu').classList.add('open');
  $('menu-overlay').classList.add('open');
  $('btn-menu-toggle').setAttribute('aria-expanded', 'true');
}

function closeMenu() {
  $('side-menu').classList.remove('open');
  $('menu-overlay').classList.remove('open');
  $('btn-menu-toggle').setAttribute('aria-expanded', 'false');
  $('menu-search').value = '';
  document.querySelectorAll('#menu-list li').forEach(li => li.classList.remove('no-match'));
}

$('btn-menu-toggle').addEventListener('click', () => {
  if ($('side-menu').classList.contains('open')) closeMenu();
  else openMenu();
});
$('btn-menu-close').addEventListener('click', closeMenu);
$('menu-overlay').addEventListener('click', closeMenu);

$('menu-search').addEventListener('input', () => {
  const q = $('menu-search').value.trim();
  document.querySelectorAll('#menu-list li').forEach(li => {
    const match = li.textContent.includes(q);
    li.classList.toggle('no-match', !match);
  });
});

document.querySelectorAll('#menu-list li').forEach(li => {
  li.addEventListener('click', () => navigateTo(li.dataset.nav));
});

// ===================== استرجاع الجلسة عند فتح الصفحة =====================
(function init() {
  const token = getToken();
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      currentUser = { username: payload.username };
      enterApp();
    } catch (e) { clearToken(); }
  }
})();
