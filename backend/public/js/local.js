// ===================== وضع "جهاز واحد" (تمرير الجوال) — بدون حساب أو إنترنت مستمر =====================
// كل الحالة محلية بالمتصفح، ما فيه سيرفر يتابعها إلا جلب قائمة الفئات مرة وحدة

let localCategories = null;   // { "اسم الفئة": ["كلمة1", "كلمة2", ...] }
let localPlayers = [];        // ["فيصل", "محمد", ...]
let localRound = null;        // { categoryName, word, spyIndex, revealIndex }

async function startLocalMode() {
  const $ = (id) => document.getElementById(id);
  show('view-local-setup');

  if (!localCategories) {
    try {
      const token = getToken();
      const res = await fetch('/api/categories', {
        headers: token ? { Authorization: 'Bearer ' + token } : {}
      });
      localCategories = await res.json();
      const sel = $('local-category-select');
      Object.keys(localCategories).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c; opt.textContent = c;
        sel.appendChild(opt);
      });
    } catch (e) {
      $('local-setup-note').textContent = 'تعذّر تحميل الفئات، تأكد من الاتصال بالإنترنت.';
    }
  }
}

// ===== رجوع للرئيسية =====
document.getElementById('btn-local-back-home').addEventListener('click', () => {
  hide('view-local-setup');
  show('view-home');
});

// ===== إضافة/حذف لاعبين =====
function renderLocalPlayersList() {
  const list = document.getElementById('local-players-list');
  list.innerHTML = '';
  localPlayers.forEach((name, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="dot"></span> <span style="flex:1;">${name}</span>`;
    const del = document.createElement('button');
    del.textContent = '✕';
    del.type = 'button';
    del.style.cssText = 'background:none;border:none;color:var(--red);font-size:16px;cursor:pointer;width:auto;padding:0 4px;';
    del.addEventListener('click', () => {
      localPlayers.splice(i, 1);
      renderLocalPlayersList();
    });
    li.appendChild(del);
    list.appendChild(li);
  });
}

document.getElementById('btn-local-add-player').addEventListener('click', addLocalPlayer);
document.getElementById('local-player-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addLocalPlayer(); }
});

function addLocalPlayer() {
  const input = document.getElementById('local-player-name');
  const name = input.value.trim();
  const note = document.getElementById('local-setup-note');
  note.textContent = '';

  if (!name) return;
  if (name.length > 20) { note.textContent = 'الاسم طويل زيادة (٢٠ حرف كحد أقصى)'; return; }
  if (localPlayers.includes(name)) { note.textContent = 'فيه لاعب بنفس الاسم'; return; }
  if (localPlayers.length >= 20) { note.textContent = 'الحد الأقصى ٢٠ لاعب'; return; }

  localPlayers.push(name);
  input.value = '';
  renderLocalPlayersList();
  input.focus();
}

// ===== بدء الجولة =====
document.getElementById('btn-local-start').addEventListener('click', () => {
  const note = document.getElementById('local-setup-note');
  if (localPlayers.length < 3) {
    note.textContent = 'لازم ٣ لاعبين على الأقل';
    return;
  }
  if (!localCategories) {
    note.textContent = 'الفئات لسا ما تحمّلت، انتظر شوي وحاول';
    return;
  }

  const chosen = document.getElementById('local-category-select').value;
  const catNames = Object.keys(localCategories);
  const categoryName = chosen && localCategories[chosen] ? chosen : catNames[Math.floor(Math.random() * catNames.length)];
  const words = localCategories[categoryName];
  const word = words[Math.floor(Math.random() * words.length)];
  const spyIndex = Math.floor(Math.random() * localPlayers.length);

  localRound = { categoryName, word, spyIndex, revealIndex: 0 };

  hide('view-local-setup');
  showLocalRevealStep();
});

// ===== كشف الأدوار وحدة وحدة =====
function showLocalRevealStep() {
  show('view-local-reveal');
  document.getElementById('local-reveal-pass').classList.remove('hidden');
  document.getElementById('local-reveal-card').classList.add('hidden');
  document.getElementById('local-reveal-name').textContent = localPlayers[localRound.revealIndex];
}

document.getElementById('btn-local-reveal-show').addEventListener('click', () => {
  document.getElementById('local-reveal-pass').classList.add('hidden');
  document.getElementById('local-reveal-card').classList.remove('hidden');

  const isSpy = localRound.revealIndex === localRound.spyIndex;
  const card = document.getElementById('local-secret-card');
  card.classList.toggle('is-spy', isSpy);
  document.getElementById('local-category-display').textContent = 'الفئة: ' + localRound.categoryName;

  if (isSpy) {
    document.getElementById('local-role-label').textContent = 'أنت برا السالفة 🕵️';
    document.getElementById('local-word-display').textContent = '؟ ما تعرف الكلمة، حاول تتصرف طبيعي';
  } else {
    document.getElementById('local-role-label').textContent = 'أنت داخل السالفة';
    document.getElementById('local-word-display').textContent = localRound.word;
  }
});

document.getElementById('btn-local-reveal-next').addEventListener('click', () => {
  localRound.revealIndex++;
  if (localRound.revealIndex >= localPlayers.length) {
    hide('view-local-reveal');
    show('view-local-play');
    document.getElementById('local-play-category').textContent = localRound.categoryName;
  } else {
    showLocalRevealStep();
  }
});

// ===== الانتقال للتصويت =====
document.getElementById('btn-local-start-voting').addEventListener('click', () => {
  hide('view-local-play');
  show('view-local-voting');

  const grid = document.getElementById('local-vote-grid');
  grid.innerHTML = '';
  localPlayers.forEach((name, i) => {
    const div = document.createElement('div');
    div.className = 'vote-option';
    div.textContent = name;
    div.addEventListener('click', () => finishLocalRound(i));
    grid.appendChild(div);
  });
});

// ===== النتائج =====
function finishLocalRound(accusedIndex) {
  hide('view-local-voting');
  show('view-local-results');

  const spyCaught = accusedIndex === localRound.spyIndex;
  const spyName = localPlayers[localRound.spyIndex];
  const accusedName = localPlayers[accusedIndex];

  document.getElementById('local-results-content').innerHTML = `
    <div class="secret-card ${spyCaught ? '' : 'is-spy'}">
      <div class="role-label">${spyCaught ? '✅ تم كشف الجاسوس' : '❌ الجاسوس نجا'}</div>
      <div class="category-name">الفئة: ${localRound.categoryName}</div>
      <div class="the-word">الكلمة: ${localRound.word}</div>
    </div>
    <p class="center-note" style="margin-top:16px;">
      الشخص المتهم: <b>${accusedName}</b><br>
      الجاسوس الحقيقي كان: <b>${spyName}</b>
    </p>
  `;
}

document.getElementById('btn-local-play-again').addEventListener('click', () => {
  hide('view-local-results');
  const spyIndex = Math.floor(Math.random() * localPlayers.length);
  const catNames = Object.keys(localCategories);
  const categoryName = catNames[Math.floor(Math.random() * catNames.length)];
  const word = localCategories[categoryName][Math.floor(Math.random() * localCategories[categoryName].length)];
  localRound = { categoryName, word, spyIndex, revealIndex: 0 };
  showLocalRevealStep();
});

document.getElementById('btn-local-new-players').addEventListener('click', () => {
  hide('view-local-results');
  localPlayers = [];
  renderLocalPlayersList();
  show('view-local-setup');
});
