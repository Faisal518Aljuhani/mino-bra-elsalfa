// ===================== لعبة "حرف، اسم، حيوان، نبات، جماد، بلاد" =====================
// فيها وضعين: جهاز واحد (تمرير الجوال، بدون حساب) وأونلاين (كل واحد بجهازه عبر غرف)

let lgCategoriesData = null; // { columns, defaultColumnIds, letters, roundSeconds }

// ----- توحيد الحروف العربية عشان المقارنة تكون عادلة (نفس منطق السيرفر بالضبط) -----
function lgNormalizeArabic(str) {
  if (!str) return '';
  return str
    .trim()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

async function lgEnsureCategoriesLoaded() {
  if (lgCategoriesData) return;
  try {
    const res = await fetch('/api/letters-categories');
    lgCategoriesData = await res.json();
  } catch (e) {
    lgCategoriesData = { columns: [], defaultColumnIds: [], letters: ['ا'], roundSeconds: 90 };
  }
}

function lgColumnLabel(id) {
  const col = ((lgCategoriesData && lgCategoriesData.columns) || []).find(c => c.id === id);
  return col ? (col.emoji + ' ' + col.label) : id;
}

// ----- عنصر اختيار الخانات (شرائح قابلة للضغط) -----
function lgRenderColumnChips(containerId, allColumns, selectedIds, onToggle, disabled) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';
  allColumns.forEach(col => {
    const chip = document.createElement('div');
    chip.className = 'lg-chip' + (selectedIds.includes(col.id) ? ' active' : '');
    chip.textContent = col.emoji + ' ' + col.label;
    if (!disabled) {
      chip.addEventListener('click', () => onToggle(col.id));
    } else {
      chip.classList.add('lg-chip-disabled');
    }
    el.appendChild(chip);
  });
}

// ----- حساب النقاط: نفس منطق السيرفر تماماً، تُستخدم لوضع جهاز واحد محلياً -----
function lgComputeRoundScoring(letterRaw, columns, answersByPlayerId) {
  const letter = lgNormalizeArabic(letterRaw);
  const perPlayer = {};
  Object.keys(answersByPlayerId).forEach(pid => { perPlayer[pid] = { answers: {}, columnPoints: {}, roundTotal: 0 }; });

  columns.forEach(colId => {
    const groups = {};
    Object.keys(answersByPlayerId).forEach(pid => {
      const raw = (answersByPlayerId[pid] && answersByPlayerId[pid][colId]) || '';
      const norm = lgNormalizeArabic(raw);
      perPlayer[pid].answers[colId] = raw;
      const valid = norm.length > 0 && norm[0] === letter;
      if (valid) {
        if (!groups[norm]) groups[norm] = [];
        groups[norm].push(pid);
      }
    });
    Object.values(groups).forEach(pids => {
      const points = pids.length === 1 ? 10 : 5;
      pids.forEach(pid => {
        perPlayer[pid].columnPoints[colId] = points;
        perPlayer[pid].roundTotal += points;
      });
    });
    Object.keys(answersByPlayerId).forEach(pid => {
      if (perPlayer[pid].columnPoints[colId] === undefined) perPlayer[pid].columnPoints[colId] = 0;
    });
  });

  return perPlayer;
}

// ----- عرض جدول نتائج الجولة (مشترك بين الوضعين) -----
function lgBuildRoundTableHtml(letter, columns, perPlayer, playersMeta) {
  let html = `<p class="center-note" style="margin-bottom:10px;">الحرف: <b style="color:var(--amber);font-size:20px;">${letter}</b></p>`;
  html += '<div style="overflow-x:auto;"><table class="lg-score-table"><thead><tr><th>اللاعب</th>';
  columns.forEach(colId => { html += `<th>${lgColumnLabel(colId)}</th>`; });
  html += '<th>المجموع</th></tr></thead><tbody>';

  playersMeta.forEach(p => {
    const data = perPlayer[p.id];
    html += `<tr><td>${p.username}</td>`;
    columns.forEach(colId => {
      const pts = data ? (data.columnPoints[colId] || 0) : 0;
      const ans = data ? (data.answers[colId] || '') : '';
      const cls = pts === 10 ? 'lg-pt-10' : pts === 5 ? 'lg-pt-5' : 'lg-pt-0';
      html += `<td><div>${ans || '—'}</div><div class="${cls}">${pts}</div></td>`;
    });
    html += `<td><b>${data ? data.roundTotal : 0}</b></td></tr>`;
  });

  html += '</tbody></table></div>';
  html += '<p class="center-note" style="margin-top:8px;">🟢 ١٠ = إجابة فريدة — 🟡 ٥ = إجابة مكررة بين لاعبين — 🔴 ٠ = خطأ أو فاضية</p>';
  return html;
}

// ----- عرض جدول النقاط التراكمي (مشترك) -----
function lgBuildScoreboardHtml(playersMeta, totalScoresMap) {
  const rows = playersMeta.map(p => ({ name: p.username, score: totalScoresMap[p.id] || 0 }));
  rows.sort((a, b) => b.score - a.score);
  let html = '<table class="lg-score-table" style="margin-top:14px;"><thead><tr><th>الترتيب</th><th>اللاعب</th><th>مجموع النقاط</th></tr></thead><tbody>';
  rows.forEach((r, i) => {
    html += `<tr><td>${i + 1}</td><td>${r.name}</td><td><b>${r.score}</b></td></tr>`;
  });
  html += '</tbody></table>';
  return html;
}

/* ==================================================================
   وضع جهاز واحد (تمرير الجوال) — بدون حساب
   ================================================================== */

let lgLocalPlayers = [];      // ["فيصل", "محمد", ...]
let lgLocalColumns = [];      // ["name","animal",...]
let lgLocalScores = {};       // index -> مجموع النقاط
let lgLocalRound = null;      // { letter, columns, turnIndex, answers: { index: {colId:text} } }
let lgLocalTimerInterval = null;
let lgLocalTimeLeft = 0;

async function startLettersLocalMode() {
  show('view-letters-local-setup');
  await lgEnsureCategoriesLoaded();
  if (lgLocalColumns.length === 0) lgLocalColumns = lgCategoriesData.defaultColumnIds.slice();
  lgRenderLocalColumnsPicker();
  lgRenderLocalPlayersList();
}

function lgRenderLocalColumnsPicker() {
  lgRenderColumnChips('lg-local-columns-list', lgCategoriesData.columns, lgLocalColumns, (id) => {
    if (lgLocalColumns.includes(id)) {
      if (lgLocalColumns.length <= 3) return;
      lgLocalColumns = lgLocalColumns.filter(c => c !== id);
    } else {
      lgLocalColumns.push(id);
    }
    lgRenderLocalColumnsPicker();
  });
}

document.getElementById('btn-lg-local-back-home').addEventListener('click', () => {
  hide('view-letters-local-setup');
  show('view-home');
});

function lgRenderLocalPlayersList() {
  const list = document.getElementById('lg-local-players-list');
  list.innerHTML = '';
  lgLocalPlayers.forEach((name, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="dot"></span> <span style="flex:1;">${name}</span>`;
    const del = document.createElement('button');
    del.textContent = '✕';
    del.type = 'button';
    del.style.cssText = 'background:none;border:none;color:var(--red);font-size:16px;cursor:pointer;width:auto;padding:0 4px;';
    del.addEventListener('click', () => {
      lgLocalPlayers.splice(i, 1);
      lgRenderLocalPlayersList();
    });
    li.appendChild(del);
    list.appendChild(li);
  });
}

document.getElementById('btn-lg-local-add-player').addEventListener('click', lgAddLocalPlayer);
document.getElementById('lg-local-player-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); lgAddLocalPlayer(); }
});

function lgAddLocalPlayer() {
  const input = document.getElementById('lg-local-player-name');
  const name = input.value.trim();
  const note = document.getElementById('lg-local-setup-note');
  note.textContent = '';

  if (!name) return;
  if (name.length > 20) { note.textContent = 'الاسم طويل زيادة (٢٠ حرف كحد أقصى)'; return; }
  if (lgLocalPlayers.includes(name)) { note.textContent = 'فيه لاعب بنفس الاسم'; return; }
  if (lgLocalPlayers.length >= 12) { note.textContent = 'الحد الأقصى ١٢ لاعب'; return; }

  lgLocalPlayers.push(name);
  input.value = '';
  lgRenderLocalPlayersList();
  input.focus();
}

document.getElementById('btn-lg-local-start').addEventListener('click', () => {
  const note = document.getElementById('lg-local-setup-note');
  if (lgLocalPlayers.length < 2) { note.textContent = 'لازم لاعبين اثنين على الأقل'; return; }
  if (lgLocalColumns.length < 3) { note.textContent = 'اختر ٣ خانات على الأقل'; return; }

  lgLocalPlayers.forEach((name, i) => { if (lgLocalScores[i] === undefined) lgLocalScores[i] = 0; });
  hide('view-letters-local-setup');
  lgStartLocalRound();
});

function lgStartLocalRound() {
  const letters = lgCategoriesData.letters;
  const letter = letters[Math.floor(Math.random() * letters.length)];
  lgLocalRound = { letter, columns: lgLocalColumns.slice(), turnIndex: 0, answers: {} };
  lgShowLocalPassScreen();
}

function lgShowLocalPassScreen() {
  show('view-letters-local-pass');
  document.getElementById('lg-local-pass-name').textContent = lgLocalPlayers[lgLocalRound.turnIndex];
  const colsText = lgLocalRound.columns.map(id => lgColumnLabel(id)).join(' · ');
  document.getElementById('lg-local-pass-columns').textContent = 'الخانات هذي الجولة: ' + colsText;
}

document.getElementById('btn-lg-local-pass-start').addEventListener('click', () => {
  hide('view-letters-local-pass');
  show('view-letters-local-turn');
  lgBuildLocalTurnInputs();
  lgStartLocalTimer();
});

function lgBuildLocalTurnInputs() {
  document.getElementById('lg-local-turn-letter').textContent = 'الحرف: ' + lgLocalRound.letter;
  const container = document.getElementById('lg-local-turn-inputs');
  container.innerHTML = '';
  lgLocalRound.columns.forEach(colId => {
    const row = document.createElement('div');
    row.className = 'lg-input-row';
    row.innerHTML = `<label>${lgColumnLabel(colId)}</label><input type="text" data-col="${colId}" maxlength="40" autocomplete="off">`;
    container.appendChild(row);
  });
  const first = container.querySelector('input');
  if (first) first.focus();
}

function lgStartLocalTimer() {
  clearInterval(lgLocalTimerInterval);
  lgLocalTimeLeft = lgCategoriesData.roundSeconds || 90;
  lgUpdateLocalTimerDisplay();
  lgLocalTimerInterval = setInterval(() => {
    lgLocalTimeLeft--;
    lgUpdateLocalTimerDisplay();
    if (lgLocalTimeLeft <= 0) {
      clearInterval(lgLocalTimerInterval);
      lgFinishLocalTurn();
    }
  }, 1000);
}

function lgUpdateLocalTimerDisplay() {
  const el = document.getElementById('lg-local-turn-timer');
  const left = Math.max(0, lgLocalTimeLeft);
  const m = Math.floor(left / 60);
  const s = left % 60;
  el.textContent = `${m}:${String(s).padStart(2, '0')}`;
  el.classList.toggle('low', left <= 10);
}

document.getElementById('btn-lg-local-done').addEventListener('click', () => {
  clearInterval(lgLocalTimerInterval);
  lgFinishLocalTurn();
});

function lgFinishLocalTurn() {
  const container = document.getElementById('lg-local-turn-inputs');
  const answers = {};
  lgLocalRound.columns.forEach(colId => {
    const input = container.querySelector(`input[data-col="${colId}"]`);
    answers[colId] = input ? input.value.trim().slice(0, 40) : '';
  });
  lgLocalRound.answers[lgLocalRound.turnIndex] = answers;
  hide('view-letters-local-turn');

  lgLocalRound.turnIndex++;
  if (lgLocalRound.turnIndex >= lgLocalPlayers.length) {
    lgFinishLocalRound();
  } else {
    lgShowLocalPassScreen();
  }
}

function lgFinishLocalRound() {
  const perPlayer = lgComputeRoundScoring(lgLocalRound.letter, lgLocalRound.columns, lgLocalRound.answers);
  lgLocalPlayers.forEach((name, i) => {
    lgLocalScores[i] = (lgLocalScores[i] || 0) + (perPlayer[i] ? perPlayer[i].roundTotal : 0);
  });

  const playersMeta = lgLocalPlayers.map((name, i) => ({ id: i, username: name }));

  show('view-letters-local-results');
  document.getElementById('lg-local-results-table').innerHTML =
    lgBuildRoundTableHtml(lgLocalRound.letter, lgLocalRound.columns, perPlayer, playersMeta);
  document.getElementById('lg-local-scoreboard').innerHTML =
    lgBuildScoreboardHtml(playersMeta, lgLocalScores);
}

document.getElementById('btn-lg-local-next-round').addEventListener('click', () => {
  hide('view-letters-local-results');
  lgStartLocalRound();
});

document.getElementById('btn-lg-local-end-game').addEventListener('click', () => {
  hide('view-letters-local-results');
  lgShowLocalGameOver();
});

function lgShowLocalGameOver() {
  show('view-letters-local-gameover');
  const playersMeta = lgLocalPlayers.map((name, i) => ({ id: i, username: name }));
  const sorted = playersMeta.slice().sort((a, b) => (lgLocalScores[b.id] || 0) - (lgLocalScores[a.id] || 0));
  const winner = sorted[0];

  document.getElementById('lg-local-gameover-content').innerHTML = `
    <div class="secret-card">
      <div class="role-label">🏆 الفائز</div>
      <div class="the-word">${winner ? winner.username : '—'}</div>
      <div class="category-name">${winner ? (lgLocalScores[winner.id] || 0) + ' نقطة' : ''}</div>
    </div>
    ${lgBuildScoreboardHtml(playersMeta, lgLocalScores)}
  `;
}

document.getElementById('btn-lg-local-restart').addEventListener('click', () => {
  hide('view-letters-local-gameover');
  lgLocalPlayers = [];
  lgLocalScores = {};
  lgRenderLocalPlayersList();
  show('view-letters-local-setup');
});

document.getElementById('btn-lg-local-home').addEventListener('click', () => {
  hide('view-letters-local-gameover');
  show('view-home');
});

/* ==================================================================
   وضع أونلاين (كل واحد بجهازه) — يحتاج نفس حساب "مين برا السالفة"
   ================================================================== */

let lgPendingOnline = false; // true = بعد تسجيل الدخول روح مباشرة للوبي لعبة الحروف
let lgRoom = null;
let lgRoomCode = null;
let lgTimerInterval = null;
let lgSubmitted = false;
let lgHostColumnsSelection = [];

async function startLettersOnlineMode() {
  await lgEnsureCategoriesLoaded();
  if (currentUser) {
    lgEnterOnlineLobby();
  } else {
    lgPendingOnline = true;
    hide('view-home');
    show('view-auth');
  }
}

function lgEnterOnlineLobby() {
  if (typeof hideAllTopViews === 'function') hideAllTopViews();
  show('view-letters-lobby');
  document.getElementById('lg-user-badge').textContent = currentUser ? currentUser.username : '';
  show('lg-lobby-choice');
  hide('lg-lobby-room');
  if (!socket) connectSocket();
}

// يُستدعى من app.js داخل connectSocket() بعد الاتصال — يسجل كل أحداث لعبة الحروف
function registerLettersSocketHandlers() {
  socket.on('lg_room_created', (room) => { lgOnRoomUpdate(room); });
  socket.on('lg_room_update', (room) => { lgOnRoomUpdate(room); });
  socket.on('lg_error', (msg) => alert(msg));

  socket.on('lg_round_started', (data) => {
    lgSubmitted = false;
    hide('view-letters-lobby'); hide('view-letters-results');
    show('view-letters-play');
    document.getElementById('lg-play-letter').textContent = 'الحرف: ' + data.letter;
    document.getElementById('lg-progress-note').textContent = '';
    document.getElementById('btn-lg-done').disabled = false;
    lgBuildOnlineInputs(data.columns);
    lgStartOnlineTimer(data.duration, data.startedAt);
  });

  socket.on('lg_progress', ({ doneCount, total }) => {
    document.getElementById('lg-progress-note').textContent = `خلص ${doneCount} من ${total} لاعبين`;
  });

  socket.on('lg_time_up', () => {
    lgAutoSubmitIfNeeded();
    document.getElementById('lg-progress-note').textContent = 'خلص الوقت! بانتظار احتساب النتيجة...';
    lgDisableOnlineInputs();
  });

  socket.on('lg_round_results', (data) => {
    clearInterval(lgTimerInterval);
    hide('view-letters-play');
    show('view-letters-results');
    document.getElementById('lg-results-table').innerHTML =
      lgBuildRoundTableHtml(data.letter, data.columns, data.perPlayer, data.players);
    document.getElementById('lg-scoreboard').innerHTML =
      lgBuildScoreboardHtml(data.players, data.totalScores);

    const isHost = lgRoom && lgRoom.hostId === getMyId();
    if (isHost) { show('lg-host-round-controls'); hide('lg-guest-round-note'); }
    else { hide('lg-host-round-controls'); show('lg-guest-round-note'); }
  });

  socket.on('lg_game_over', (data) => {
    hide('view-letters-results'); hide('view-letters-play');
    show('view-letters-gameover');
    const sorted = data.players.slice().sort((a, b) => (data.totalScores[b.id] || 0) - (data.totalScores[a.id] || 0));
    const winner = sorted[0];
    document.getElementById('lg-gameover-content').innerHTML = `
      <div class="secret-card">
        <div class="role-label">🏆 الفائز</div>
        <div class="the-word">${winner ? winner.username : '—'}</div>
        <div class="category-name">${winner ? (data.totalScores[winner.id] || 0) + ' نقطة' : ''}</div>
      </div>
      ${lgBuildScoreboardHtml(data.players, data.totalScores)}
    `;
  });

  socket.emit('lg_get_categories');
  socket.on('lg_categories_list', (cols) => {
    if (!lgCategoriesData) lgCategoriesData = {};
    lgCategoriesData.columns = cols;
  });
}

function lgOnRoomUpdate(room) {
  lgRoom = room;
  lgRoomCode = room.code;

  hide('view-letters-play'); hide('view-letters-results'); hide('view-letters-gameover');
  show('view-letters-lobby');
  hide('lg-lobby-choice');
  show('lg-lobby-room');

  document.getElementById('lg-room-code-display').textContent = room.code;

  const list = document.getElementById('lg-players-list');
  list.innerHTML = '';
  room.players.forEach(p => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="dot"></span> ${p.username}` + (p.id === room.hostId ? `<span class="host-badge">المضيف</span>` : '');
    list.appendChild(li);
  });

  const isHost = room.hostId === getMyId();
  lgHostColumnsSelection = room.columns.slice();
  if (isHost) {
    show('lg-host-controls'); hide('lg-waiting-note');
    lgRenderOnlineColumnsPicker(true);
  } else {
    hide('lg-host-controls'); show('lg-waiting-note');
  }
}

function lgRenderOnlineColumnsPicker(interactive) {
  const cols = (lgCategoriesData && lgCategoriesData.columns) || [];
  lgRenderColumnChips('lg-columns-list', cols, lgHostColumnsSelection, (id) => {
    if (lgHostColumnsSelection.includes(id)) {
      if (lgHostColumnsSelection.length <= 3) return;
      lgHostColumnsSelection = lgHostColumnsSelection.filter(c => c !== id);
    } else {
      lgHostColumnsSelection.push(id);
    }
    socket.emit('lg_set_columns', { roomCode: lgRoomCode, columns: lgHostColumnsSelection });
    lgRenderOnlineColumnsPicker(true);
  }, !interactive);
}

document.getElementById('btn-lg-create-room').addEventListener('click', () => {
  socket.emit('lg_create_room');
});

document.getElementById('btn-lg-join-room').addEventListener('click', () => {
  const code = document.getElementById('lg-join-code').value.trim().toUpperCase();
  if (!code) return alert('اكتب كود الغرفة');
  socket.emit('lg_join_room', { roomCode: code });
});

document.getElementById('btn-lg-start-round').addEventListener('click', () => {
  socket.emit('lg_start_round', { roomCode: lgRoomCode });
});

document.getElementById('btn-lg-next-round').addEventListener('click', () => {
  socket.emit('lg_next_round', { roomCode: lgRoomCode });
});

document.getElementById('btn-lg-end-game').addEventListener('click', () => {
  socket.emit('lg_end_game', { roomCode: lgRoomCode });
});

document.getElementById('btn-lg-done').addEventListener('click', () => {
  lgSubmitAnswers();
});

document.getElementById('btn-lg-play-new').addEventListener('click', () => {
  hide('view-letters-gameover');
  lgEnterOnlineLobby();
});

document.getElementById('btn-lg-home').addEventListener('click', () => {
  hide('view-letters-gameover');
  show('view-home');
});

document.getElementById('btn-lg-lobby-back-home').addEventListener('click', () => {
  hide('view-letters-lobby');
  show('view-home');
});

function lgBuildOnlineInputs(columns) {
  const container = document.getElementById('lg-play-inputs');
  container.innerHTML = '';
  columns.forEach(colId => {
    const row = document.createElement('div');
    row.className = 'lg-input-row';
    row.innerHTML = `<label>${lgColumnLabel(colId)}</label><input type="text" data-col="${colId}" maxlength="40" autocomplete="off">`;
    container.appendChild(row);
  });
  const first = container.querySelector('input');
  if (first) first.focus();
}

function lgDisableOnlineInputs() {
  document.querySelectorAll('#lg-play-inputs input').forEach(inp => inp.disabled = true);
}

function lgCollectOnlineAnswers() {
  const answers = {};
  document.querySelectorAll('#lg-play-inputs input').forEach(inp => {
    answers[inp.dataset.col] = inp.value.trim().slice(0, 40);
  });
  return answers;
}

function lgSubmitAnswers() {
  if (lgSubmitted) return;
  lgSubmitted = true;
  const answers = lgCollectOnlineAnswers();
  lgDisableOnlineInputs();
  document.getElementById('btn-lg-done').disabled = true;
  socket.emit('lg_submit_done', { roomCode: lgRoomCode, answers });
}

function lgAutoSubmitIfNeeded() {
  if (!lgSubmitted) lgSubmitAnswers();
}

function lgStartOnlineTimer(duration, startedAt) {
  clearInterval(lgTimerInterval);
  const update = () => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    const left = Math.max(0, duration - elapsed);
    const el = document.getElementById('lg-play-timer');
    const m = Math.floor(left / 60);
    const s = left % 60;
    el.textContent = `${m}:${String(s).padStart(2, '0')}`;
    el.classList.toggle('low', left <= 10);
    if (left <= 0) clearInterval(lgTimerInterval);
  };
  update();
  lgTimerInterval = setInterval(update, 1000);
}

/* ===== ربط أزرار الشاشة الرئيسية ===== */
document.getElementById('btn-mode-letters-online').addEventListener('click', () => {
  hide('view-home');
  startLettersOnlineMode();
});
document.getElementById('btn-mode-letters-local').addEventListener('click', () => {
  hide('view-home');
  startLettersLocalMode();
});
