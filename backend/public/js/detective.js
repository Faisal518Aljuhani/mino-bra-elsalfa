// ===================== لعبة "قصة جنائية" — تحدي فردي بدون حساب =====================

let dtAllCases = null;     // كل القضايا من السيرفر
let dtRoundCases = [];     // القضايا المختارة لهذي الجولة (مخلوطة)
let dtIndex = 0;
let dtScore = 0;
let dtTimerEnabled = true;
let dtTimerInterval = null;
let dtTimeLeft = 0;

const DT_ROUND_SIZE = 8; // عدد القضايا بكل جولة

// مدة كل قضية بالثواني حسب مستوى الصعوبة
const DT_LEVEL_SECONDS = { 1: 15 * 60, 2: 10 * 60, 3: 4 * 60 + 30 };

function dtShuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function dtFormatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function startDetectiveMode() {
  show('view-detective-setup');

  if (!dtAllCases) {
    try {
      const res = await fetch('/api/detective-cases');
      dtAllCases = await res.json();
    } catch (e) {
      dtAllCases = [];
    }
  }
}

document.getElementById('btn-detective-start').addEventListener('click', () => {
  const levelChoice = document.getElementById('detective-level-select').value;
  dtTimerEnabled = document.getElementById('detective-timer-toggle').checked;

  let pool = dtAllCases || [];
  if (levelChoice !== 'mixed') {
    const lvl = Number(levelChoice);
    pool = pool.filter(c => c.level === lvl);
  }

  if (pool.length === 0) {
    alert('ما فيه قضايا متوفرة لهذا المستوى حالياً، جرب مستوى ثاني.');
    return;
  }

  hide('view-detective-setup');
  show('view-detective-play');
  dtStartRound(pool);
});

function dtStartRound(pool) {
  dtIndex = 0;
  dtScore = 0;
  const count = Math.min(DT_ROUND_SIZE, pool.length);
  dtRoundCases = dtShuffle(pool).slice(0, count);
  dtShowCase();
}

function dtShowCase() {
  clearInterval(dtTimerInterval);
  document.getElementById('detective-feedback').textContent = '';
  document.getElementById('btn-detective-next').classList.add('hidden');

  const c = dtRoundCases[dtIndex];
  document.getElementById('detective-progress').textContent =
    `قضية ${dtIndex + 1} من ${dtRoundCases.length} — النقاط: ${dtScore}`;
  document.getElementById('detective-story-display').textContent = c.story;

  const choicesBox = document.getElementById('detective-choices');
  choicesBox.innerHTML = '';
  dtShuffle(c.choices).forEach(choice => {
    const btn = document.createElement('button');
    btn.className = 'btn-ghost';
    btn.textContent = choice;
    btn.addEventListener('click', () => dtAnswer(choice, btn));
    choicesBox.appendChild(btn);
  });

  const timerCard = document.getElementById('detective-timer-card');
  if (dtTimerEnabled) {
    timerCard.classList.remove('hidden');
    dtTimeLeft = DT_LEVEL_SECONDS[c.level] || DT_LEVEL_SECONDS[1];
    document.getElementById('detective-timer-display').textContent = dtFormatTime(dtTimeLeft);
    dtTimerInterval = setInterval(() => {
      dtTimeLeft--;
      document.getElementById('detective-timer-display').textContent = dtFormatTime(Math.max(dtTimeLeft, 0));
      if (dtTimeLeft <= 0) {
        clearInterval(dtTimerInterval);
        dtTimeUp();
      }
    }, 1000);
  } else {
    timerCard.classList.add('hidden');
  }
}

function dtTimeUp() {
  const c = dtRoundCases[dtIndex];
  const feedback = document.getElementById('detective-feedback');
  const allBtns = document.querySelectorAll('#detective-choices button');
  allBtns.forEach(b => {
    b.disabled = true;
    if (b.textContent === c.answer) {
      b.style.borderColor = 'var(--green)';
      b.style.color = 'var(--green)';
    }
  });
  feedback.innerHTML = `<span style="color:var(--red);">⏱️ خلص الوقت! الإجابة الصحيحة: ${c.answer}</span>`;
  document.getElementById('btn-detective-next').classList.remove('hidden');
}

function dtAnswer(choice, clickedBtn) {
  clearInterval(dtTimerInterval);
  const c = dtRoundCases[dtIndex];
  const feedback = document.getElementById('detective-feedback');
  const allBtns = document.querySelectorAll('#detective-choices button');
  allBtns.forEach(b => b.disabled = true);

  if (choice === c.answer) {
    dtScore++;
    clickedBtn.style.borderColor = 'var(--green)';
    clickedBtn.style.color = 'var(--green)';
    feedback.innerHTML = '<span style="color:var(--green);">✅ استنتاج صحيح!</span>';
  } else {
    clickedBtn.style.borderColor = 'var(--red)';
    clickedBtn.style.color = 'var(--red)';
    feedback.innerHTML = `<span style="color:var(--red);">❌ غلط — الحل الصحيح: ${c.answer}</span>`;
    allBtns.forEach(b => {
      if (b.textContent === c.answer) {
        b.style.borderColor = 'var(--green)';
        b.style.color = 'var(--green)';
      }
    });
  }

  document.getElementById('detective-progress').textContent =
    `قضية ${dtIndex + 1} من ${dtRoundCases.length} — النقاط: ${dtScore}`;
  document.getElementById('btn-detective-next').classList.remove('hidden');
}

document.getElementById('btn-detective-next').addEventListener('click', () => {
  dtIndex++;
  if (dtIndex >= dtRoundCases.length) {
    dtShowResults();
  } else {
    dtShowCase();
  }
});

function dtShowResults() {
  clearInterval(dtTimerInterval);
  hide('view-detective-play');
  show('view-detective-results');

  const total = dtRoundCases.length;
  const pct = Math.round((dtScore / total) * 100);
  let comment = 'محقق مبتدئ، جرب مرة ثانية 🔍';
  if (pct >= 80) comment = 'محقق محنّك! ما تفوتك قضية 🕵️‍♂️';
  else if (pct >= 50) comment = 'تحليل جيد، بس فيه غموض لسا 👀';

  document.getElementById('detective-results-content').innerHTML = `
    <div class="secret-card">
      <div class="role-label">نتيجتك</div>
      <div class="the-word">${dtScore} / ${total}</div>
      <div class="category-name">${pct}%</div>
    </div>
    <p class="center-note" style="margin-top:16px;">${comment}</p>
  `;
}

document.getElementById('btn-detective-restart').addEventListener('click', () => {
  hide('view-detective-results');
  show('view-detective-setup');
});

document.getElementById('btn-detective-home').addEventListener('click', () => {
  hide('view-detective-results');
  show('view-home');
});

document.getElementById('btn-detective-back-home').addEventListener('click', () => {
  clearInterval(dtTimerInterval);
  hide('view-detective-play');
  show('view-home');
});

document.getElementById('btn-detective-setup-back-home').addEventListener('click', () => {
  hide('view-detective-setup');
  show('view-home');
});
