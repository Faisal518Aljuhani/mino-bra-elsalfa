// ===================== لعبة "المافيا" — وضع جهاز واحد (تمرير الجوال) =====================
// كل الحالة محلية بالمتصفح، ما فيه سيرفر يتابعها إطلاقاً

let mafiaPlayers = [];      // ["فيصل", "محمد", ...]
let mafiaRoles = [];        // دور كل لاعب بنفس ترتيب mafiaPlayers: 'mafia' | 'citizen' | 'detective' | 'doctor'
let mafiaAlive = [];        // true/false بنفس الترتيب
let mafiaRevealIndex = 0;
let mafiaRound = 1;

// حالة مرحلة الليل الحالية
let mafiaNightSteps = [];   // مثال: ['mafia','detective','doctor']
let mafiaNightStepIndex = 0;
let mafiaNightTarget = null;      // ضحية المافيا (index)
let mafiaDetectiveTarget = null;
let mafiaDoctorTarget = null;

const MAFIA_ROLE_INFO = {
  mafia: {
    label: 'أنت من فريق المافيا 🔪',
    name: 'مافيا',
    desc: 'مهمتك تتخلص من المواطنين بدون ما ينكشف أمرك. بالليل تتفقون سوا مع بقية أفراد المافيا على ضحية وحدة.'
  },
  citizen: {
    label: 'أنت مواطن 👤',
    name: 'مواطن',
    desc: 'ما عندك أي قدرة خاصة. اعتمد على النقاش والتحليل عشان تكتشف مين المافيا، وصوّت بذكاء بالنهار.'
  },
  detective: {
    label: 'أنت المحقق 🕵️',
    name: 'محقق',
    desc: 'كل ليلة تقدر تتحقق من هوية لاعب وحد وتعرف إذا كان من المافيا أو لا — بدون ما تكشف نفسك للباقين.'
  },
  doctor: {
    label: 'أنت الطبيب 🩺',
    name: 'طبيب',
    desc: 'كل ليلة تختار لاعب وحد تحميه من محاولة القتل. لو حميت الضحية الصح، تنجو تلقائياً.'
  }
};

// ===== توزيع الأدوار حسب عدد اللاعبين =====
function getMafiaRoleDistribution(n) {
  const mafiaCount = Math.max(1, Math.floor(n / 4));
  const hasDetective = n >= 5;
  const hasDoctor = n >= 7;
  const citizens = n - mafiaCount - (hasDetective ? 1 : 0) - (hasDoctor ? 1 : 0);
  return { mafiaCount, hasDetective, hasDoctor, citizens: Math.max(0, citizens) };
}

function mafiaRolePreviewText(n) {
  if (n < 5) return `تحتاج ٥ لاعبين على الأقل (الحين: ${n})`;
  if (n > 20) return `الحد الأقصى ٢٠ لاعب (الحين: ${n})`;
  const d = getMafiaRoleDistribution(n);
  const parts = [`🔪 ${d.mafiaCount} مافيا`];
  if (d.hasDetective) parts.push('🕵️ ١ محقق');
  if (d.hasDoctor) parts.push('🩺 ١ طبيب');
  parts.push(`👤 ${d.citizens} مواطن`);
  return 'توزيع الأدوار: ' + parts.join(' — ');
}

async function startMafiaMode() {
  // لعبة المافيا مدفوعة — تحتاج اشتراك لمّة بلس أو فتحها بالكوينز
  if (typeof refreshShopAccess === 'function') await refreshShopAccess();
  const access = window.shopAccess;
  const unlocked = access && (access.hasMafia || access.subscriptionActive);

  if (!unlocked) {
    if (typeof startShopMode === 'function') {
      startShopMode();
      setTimeout(() => {
        const msg = document.getElementById('shop-message');
        if (msg) msg.innerHTML = '<div class="error-box">لعبة المافيا تحتاج فتح من المتجر أو اشتراك لمّة بلس 👑</div>';
      }, 100);
    } else {
      alert('لعبة المافيا تحتاج فتح من المتجر أو اشتراك لمّة بلس');
    }
    return;
  }

  show('view-mafia-setup');
  updateMafiaRolePreview();
}

function updateMafiaRolePreview() {
  document.getElementById('mafia-role-preview').textContent = mafiaRolePreviewText(mafiaPlayers.length);
}

// ===== رجوع للرئيسية =====
document.getElementById('btn-mafia-back-home').addEventListener('click', () => {
  hide('view-mafia-setup');
  show('view-home');
});

// ===== إضافة/حذف لاعبين =====
function renderMafiaPlayersList() {
  const list = document.getElementById('mafia-players-list');
  list.innerHTML = '';
  mafiaPlayers.forEach((name, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="dot"></span> <span style="flex:1;">${name}</span>`;
    const del = document.createElement('button');
    del.textContent = '✕';
    del.type = 'button';
    del.style.cssText = 'background:none;border:none;color:var(--red);font-size:16px;cursor:pointer;width:auto;padding:0 4px;';
    del.addEventListener('click', () => {
      mafiaPlayers.splice(i, 1);
      renderMafiaPlayersList();
      updateMafiaRolePreview();
    });
    li.appendChild(del);
    list.appendChild(li);
  });
  updateMafiaRolePreview();
}

document.getElementById('btn-mafia-add-player').addEventListener('click', addMafiaPlayer);
document.getElementById('mafia-player-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addMafiaPlayer(); }
});

function addMafiaPlayer() {
  const input = document.getElementById('mafia-player-name');
  const name = input.value.trim();
  const note = document.getElementById('mafia-setup-note');
  note.textContent = '';

  if (!name) return;
  if (name.length > 20) { note.textContent = 'الاسم طويل زيادة (٢٠ حرف كحد أقصى)'; return; }
  if (mafiaPlayers.includes(name)) { note.textContent = 'فيه لاعب بنفس الاسم'; return; }
  if (mafiaPlayers.length >= 20) { note.textContent = 'الحد الأقصى ٢٠ لاعب'; return; }

  mafiaPlayers.push(name);
  input.value = '';
  renderMafiaPlayersList();
  input.focus();
}

// ===== توزيع الأدوار عشوائياً =====
function assignMafiaRoles() {
  const n = mafiaPlayers.length;
  const d = getMafiaRoleDistribution(n);
  const roles = [];
  for (let i = 0; i < d.mafiaCount; i++) roles.push('mafia');
  if (d.hasDetective) roles.push('detective');
  if (d.hasDoctor) roles.push('doctor');
  for (let i = 0; i < d.citizens; i++) roles.push('citizen');

  // خلط الأدوار عشوائياً
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }
  mafiaRoles = roles;
  mafiaAlive = mafiaPlayers.map(() => true);
}

// ===== بدء اللعبة =====
document.getElementById('btn-mafia-start').addEventListener('click', () => {
  const note = document.getElementById('mafia-setup-note');
  if (mafiaPlayers.length < 5) { note.textContent = 'لازم ٥ لاعبين على الأقل'; return; }
  if (mafiaPlayers.length > 20) { note.textContent = 'الحد الأقصى ٢٠ لاعب'; return; }

  assignMafiaRoles();
  mafiaRevealIndex = 0;
  mafiaRound = 1;

  hide('view-mafia-setup');
  showMafiaRevealStep();
});

// ===== كشف الأدوار وحدة وحدة =====
function showMafiaRevealStep() {
  show('view-mafia-reveal');
  document.getElementById('mafia-reveal-pass').classList.remove('hidden');
  document.getElementById('mafia-reveal-card').classList.add('hidden');
  document.getElementById('mafia-reveal-name').textContent = mafiaPlayers[mafiaRevealIndex];
}

document.getElementById('btn-mafia-reveal-show').addEventListener('click', () => {
  document.getElementById('mafia-reveal-pass').classList.add('hidden');
  document.getElementById('mafia-reveal-card').classList.remove('hidden');

  const role = mafiaRoles[mafiaRevealIndex];
  const info = MAFIA_ROLE_INFO[role];
  const card = document.getElementById('mafia-secret-card');
  card.classList.toggle('is-spy', role === 'mafia');

  document.getElementById('mafia-role-label').textContent = info.label;
  document.getElementById('mafia-role-name-display').textContent = info.name;
  document.getElementById('mafia-role-desc').textContent = info.desc;

  const teammatesNote = document.getElementById('mafia-teammates-note');
  if (role === 'mafia') {
    const teammates = mafiaPlayers.filter((p, i) => mafiaRoles[i] === 'mafia' && i !== mafiaRevealIndex);
    teammatesNote.textContent = teammates.length
      ? 'زملاؤك بالمافيا: ' + teammates.join('، ')
      : 'أنت المافيا الوحيد بهذي الجولة';
  } else {
    teammatesNote.textContent = '';
  }
});

document.getElementById('btn-mafia-reveal-next').addEventListener('click', () => {
  mafiaRevealIndex++;
  if (mafiaRevealIndex >= mafiaPlayers.length) {
    hide('view-mafia-reveal');
    startMafiaNight();
  } else {
    showMafiaRevealStep();
  }
});

// ===== مساعدين =====
function mafiaAliveIndexes() {
  return mafiaAlive.map((a, i) => a ? i : -1).filter(i => i !== -1);
}
function mafiaCountAliveByTeam() {
  let mafiaCount = 0, othersCount = 0;
  mafiaAliveIndexes().forEach(i => {
    if (mafiaRoles[i] === 'mafia') mafiaCount++; else othersCount++;
  });
  return { mafiaCount, othersCount };
}
function checkMafiaWin() {
  const { mafiaCount, othersCount } = mafiaCountAliveByTeam();
  if (mafiaCount === 0) return 'citizens';
  if (mafiaCount >= othersCount) return 'mafia';
  return null;
}

// ===== مرحلة الليل =====
function startMafiaNight() {
  mafiaNightTarget = null;
  mafiaDetectiveTarget = null;
  mafiaDoctorTarget = null;

  mafiaNightSteps = ['mafia'];
  const detectiveIdx = mafiaRoles.indexOf('detective');
  if (detectiveIdx !== -1 && mafiaAlive[detectiveIdx]) mafiaNightSteps.push('detective');
  const doctorIdx = mafiaRoles.indexOf('doctor');
  if (doctorIdx !== -1 && mafiaAlive[doctorIdx]) mafiaNightSteps.push('doctor');

  mafiaNightStepIndex = 0;
  show('view-mafia-night');
  document.getElementById('mafia-night-round').textContent = 'الجولة ' + mafiaRound;
  runMafiaNightStep();
}

function runMafiaNightStep() {
  document.getElementById('mafia-night-action').classList.add('hidden');
  document.getElementById('mafia-night-pass').classList.remove('hidden');
  document.getElementById('btn-mafia-night-next').classList.add('hidden');

  const step = mafiaNightSteps[mafiaNightStepIndex];
  const passText = document.getElementById('mafia-night-pass-text');
  if (step === 'mafia') {
    passText.innerHTML = 'مرر الجهاز لأفراد <b style="color:var(--red);">المافيا</b><br>(يتفقون سوا على الضحية)';
  } else if (step === 'detective') {
    const idx = mafiaRoles.indexOf('detective');
    passText.innerHTML = 'مرر الجهاز لـ<br><b style="color:var(--amber);">' + mafiaPlayers[idx] + '</b> (المحقق)';
  } else if (step === 'doctor') {
    const idx = mafiaRoles.indexOf('doctor');
    passText.innerHTML = 'مرر الجهاز لـ<br><b style="color:var(--amber);">' + mafiaPlayers[idx] + '</b> (الطبيب)';
  }
}

document.getElementById('btn-mafia-night-show').addEventListener('click', () => {
  document.getElementById('mafia-night-pass').classList.add('hidden');
  document.getElementById('mafia-night-action').classList.remove('hidden');

  const step = mafiaNightSteps[mafiaNightStepIndex];
  const instruction = document.getElementById('mafia-night-instruction');
  const choicesBox = document.getElementById('mafia-night-choices');
  const feedback = document.getElementById('mafia-night-feedback');
  choicesBox.innerHTML = '';
  feedback.textContent = '';
  document.getElementById('btn-mafia-night-next').classList.add('hidden');

  let selectable = mafiaAliveIndexes();
  if (step === 'mafia') {
    instruction.textContent = 'اختاروا الضحية:';
    selectable = selectable.filter(i => mafiaRoles[i] !== 'mafia');
  } else if (step === 'detective') {
    const detIdx = mafiaRoles.indexOf('detective');
    instruction.textContent = 'اختر لاعب عشان تتحقق منه:';
    selectable = selectable.filter(i => i !== detIdx);
  } else if (step === 'doctor') {
    instruction.textContent = 'اختر لاعب تحميه الليلة:';
  }

  selectable.forEach(i => {
    const div = document.createElement('div');
    div.className = 'vote-option';
    div.textContent = mafiaPlayers[i];
    div.addEventListener('click', () => {
      document.querySelectorAll('#mafia-night-choices .vote-option').forEach(el => {
        el.classList.remove('selected');
        el.style.pointerEvents = 'none';
      });
      div.classList.add('selected');
      handleMafiaNightChoice(step, i);
    });
    choicesBox.appendChild(div);
  });
});

function handleMafiaNightChoice(step, index) {
  const feedback = document.getElementById('mafia-night-feedback');
  if (step === 'mafia') {
    mafiaNightTarget = index;
    feedback.textContent = 'تم تحديد الضحية: ' + mafiaPlayers[index];
  } else if (step === 'detective') {
    mafiaDetectiveTarget = index;
    const isMafia = mafiaRoles[index] === 'mafia';
    feedback.textContent = mafiaPlayers[index] + (isMafia ? ' هو فرد من المافيا! 🔪' : ' مو من المافيا 👤');
  } else if (step === 'doctor') {
    mafiaDoctorTarget = index;
    feedback.textContent = 'تم اختيار ' + mafiaPlayers[index] + ' للحماية الليلة';
  }
  document.getElementById('btn-mafia-night-next').classList.remove('hidden');
}

document.getElementById('btn-mafia-night-next').addEventListener('click', () => {
  mafiaNightStepIndex++;
  if (mafiaNightStepIndex < mafiaNightSteps.length) {
    runMafiaNightStep();
  } else {
    resolveMafiaNight();
  }
});

// mafiaDayPhase يحدد وش يسوي زر النهار: يفتح التصويت أو يبدأ الليل التالي مباشرة
let mafiaDayPhase = 'awaiting-vote'; // 'awaiting-vote' | 'awaiting-next-night'

function resolveMafiaNight() {
  hide('view-mafia-night');

  let deadName = null;
  if (mafiaNightTarget !== null) {
    const saved = mafiaDoctorTarget !== null && mafiaDoctorTarget === mafiaNightTarget;
    if (!saved) {
      mafiaAlive[mafiaNightTarget] = false;
      deadName = mafiaPlayers[mafiaNightTarget];
    }
  }

  const winner = checkMafiaWin();
  if (winner) {
    showMafiaResults(winner, deadName ? `الليلة راح: ${deadName}` : 'ما مات أحد هذي الليلة 🌙');
    return;
  }

  mafiaDayPhase = 'awaiting-vote';
  document.getElementById('btn-mafia-start-voting').textContent = 'ابدأ التصويت';
  show('view-mafia-day');
  document.getElementById('mafia-day-round').textContent = 'الجولة ' + mafiaRound;
  document.getElementById('mafia-day-result').innerHTML = deadName
    ? `<div class="error-box">💀 هذا الصبح لقوا <b>${deadName}</b> متوفي</div>`
    : `<div class="success-box">🩺 الطبيب نجح ينقذ الضحية، ما مات أحد الليلة!</div>`;
}

// ===== زر النهار: يفتح التصويت أو يبدأ الليل التالي حسب الحالة =====
document.getElementById('btn-mafia-start-voting').addEventListener('click', () => {
  if (mafiaDayPhase === 'awaiting-next-night') {
    hide('view-mafia-day');
    startMafiaNight();
    return;
  }
  hide('view-mafia-day');
  renderMafiaVoteGrid();
  show('view-mafia-voting');
});

function renderMafiaVoteGrid() {
  const grid = document.getElementById('mafia-vote-grid');
  grid.innerHTML = '';
  mafiaAliveIndexes().forEach(i => {
    const div = document.createElement('div');
    div.className = 'vote-option';
    div.textContent = mafiaPlayers[i];
    div.addEventListener('click', () => finishMafiaVote(i));
    grid.appendChild(div);
  });
}

function finishMafiaVote(accusedIndex) {
  hide('view-mafia-voting');
  mafiaAlive[accusedIndex] = false;
  const accusedName = mafiaPlayers[accusedIndex];
  const wasMafia = mafiaRoles[accusedIndex] === 'mafia';

  const winner = checkMafiaWin();
  if (winner) {
    showMafiaResults(winner, `تم التصويت على <b>${accusedName}</b> — ${wasMafia ? 'وطلع فعلاً من المافيا! 🔪' : 'بس طلع مواطن بريء 😅'}`);
    return;
  }

  mafiaRound++;
  mafiaDayPhase = 'awaiting-next-night';
  document.getElementById('btn-mafia-start-voting').textContent = 'ابدأ الليل التالي';
  show('view-mafia-day');
  document.getElementById('mafia-day-round').textContent = 'الجولة ' + mafiaRound;
  document.getElementById('mafia-day-result').innerHTML = `
    <div class="${wasMafia ? 'success-box' : 'error-box'}">
      تم إخراج <b>${accusedName}</b> — ${wasMafia ? '✅ وطلع من المافيا!' : '❌ بس طلع مواطن بريء'}
    </div>`;
}

// ===== النتيجة النهائية =====
function showMafiaResults(winner, eventNote) {
  hide('view-mafia-night'); hide('view-mafia-day'); hide('view-mafia-voting');
  show('view-mafia-results');

  const rolesList = mafiaPlayers.map((name, i) => {
    const info = MAFIA_ROLE_INFO[mafiaRoles[i]];
    const status = mafiaAlive[i] ? 'حي' : 'خارج اللعبة';
    return `<li><span class="dot" style="background:${mafiaAlive[i] ? 'var(--green)' : 'var(--red)'};"></span> <span style="flex:1;">${name} — ${info.name}</span><span class="host-badge" style="border-color:var(--muted);color:var(--muted);">${status}</span></li>`;
  }).join('');

  document.getElementById('mafia-results-content').innerHTML = `
    <div class="secret-card ${winner === 'mafia' ? 'is-spy' : ''}">
      <div class="role-label">${winner === 'mafia' ? '🔪 فازت المافيا' : '✅ فاز المواطنون'}</div>
    </div>
    <p class="center-note" style="margin:14px 0;">${eventNote || ''}</p>
    <ul class="players-list" style="margin-top:10px;">${rolesList}</ul>
  `;
}

document.getElementById('btn-mafia-play-again').addEventListener('click', () => {
  hide('view-mafia-results');
  assignMafiaRoles();
  mafiaRevealIndex = 0;
  mafiaRound = 1;
  showMafiaRevealStep();
});

document.getElementById('btn-mafia-new-players').addEventListener('click', () => {
  hide('view-mafia-results');
  mafiaPlayers = [];
  renderMafiaPlayersList();
  show('view-mafia-setup');
});
