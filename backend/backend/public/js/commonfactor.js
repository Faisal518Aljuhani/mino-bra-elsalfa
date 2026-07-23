// ===================== لعبة "العامل المشترك" — تحدي فردي بدون حساب =====================

let cfAllQuestions = null;   // كل الأسئلة من السيرفر
let cfRoundQuestions = [];   // الأسئلة المختارة لهذي الجولة (مخلوطة)
let cfIndex = 0;
let cfScore = 0;
const CF_ROUND_SIZE = 10; // عدد الأسئلة بكل جولة

function cfShuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function startCommonFactorMode() {
  show('view-cf-play');

  if (!cfAllQuestions) {
    try {
      const res = await fetch('/api/common-factor');
      cfAllQuestions = await res.json();
    } catch (e) {
      document.getElementById('cf-items-display').textContent = 'تعذّر تحميل الأسئلة، تأكد من الاتصال بالإنترنت.';
      return;
    }
  }

  cfStartRound();
}

function cfStartRound() {
  cfIndex = 0;
  cfScore = 0;
  const count = Math.min(CF_ROUND_SIZE, cfAllQuestions.length);
  cfRoundQuestions = cfShuffle(cfAllQuestions).slice(0, count);
  cfShowQuestion();
}

function cfShowQuestion() {
  document.getElementById('cf-feedback').textContent = '';
  document.getElementById('btn-cf-next').classList.add('hidden');

  const q = cfRoundQuestions[cfIndex];
  document.getElementById('cf-progress').textContent = `سؤال ${cfIndex + 1} من ${cfRoundQuestions.length} — النقاط: ${cfScore}`;
  document.getElementById('cf-items-display').textContent = q.items.join(' - ');

  const choicesBox = document.getElementById('cf-choices');
  choicesBox.innerHTML = '';
  cfShuffle(q.choices).forEach(choice => {
    const btn = document.createElement('button');
    btn.className = 'btn-ghost';
    btn.textContent = choice;
    btn.addEventListener('click', () => cfAnswer(choice, btn));
    choicesBox.appendChild(btn);
  });
}

function cfAnswer(choice, clickedBtn) {
  const q = cfRoundQuestions[cfIndex];
  const feedback = document.getElementById('cf-feedback');
  const allBtns = document.querySelectorAll('#cf-choices button');
  allBtns.forEach(b => b.disabled = true);

  if (choice === q.answer) {
    cfScore++;
    clickedBtn.style.borderColor = 'var(--green)';
    clickedBtn.style.color = 'var(--green)';
    feedback.innerHTML = '<span style="color:var(--green);">✅ صح!</span>';
  } else {
    clickedBtn.style.borderColor = 'var(--red)';
    clickedBtn.style.color = 'var(--red)';
    feedback.innerHTML = `<span style="color:var(--red);">❌ غلط — الإجابة الصحيحة: ${q.answer}</span>`;
    allBtns.forEach(b => {
      if (b.textContent === q.answer) {
        b.style.borderColor = 'var(--green)';
        b.style.color = 'var(--green)';
      }
    });
  }

  document.getElementById('cf-progress').textContent = `سؤال ${cfIndex + 1} من ${cfRoundQuestions.length} — النقاط: ${cfScore}`;
  document.getElementById('btn-cf-next').classList.remove('hidden');
}

document.getElementById('btn-cf-next').addEventListener('click', () => {
  cfIndex++;
  if (cfIndex >= cfRoundQuestions.length) {
    cfShowResults();
  } else {
    cfShowQuestion();
  }
});

function cfShowResults() {
  hide('view-cf-play');
  show('view-cf-results');

  const total = cfRoundQuestions.length;
  const pct = Math.round((cfScore / total) * 100);
  let comment = 'محاولة حلوة، جرب مرة ثانية 💪';
  if (pct >= 80) comment = 'ملاحظتك قوية جداً! 🔥';
  else if (pct >= 50) comment = 'مو باس، بس تقدر أحسن! 👍';

  document.getElementById('cf-results-content').innerHTML = `
    <div class="secret-card">
      <div class="role-label">نتيجتك</div>
      <div class="the-word">${cfScore} / ${total}</div>
      <div class="category-name">${pct}%</div>
    </div>
    <p class="center-note" style="margin-top:16px;">${comment}</p>
  `;
}

document.getElementById('btn-cf-restart').addEventListener('click', () => {
  hide('view-cf-results');
  show('view-cf-play');
  cfStartRound();
});

document.getElementById('btn-cf-home').addEventListener('click', () => {
  hide('view-cf-results');
  show('view-home');
});

document.getElementById('btn-cf-back-home').addEventListener('click', () => {
  hide('view-cf-play');
  show('view-home');
});
