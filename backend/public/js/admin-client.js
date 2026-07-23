const $ = (id) => document.getElementById(id);

function getAdminToken() { return localStorage.getItem('adminToken'); }
function setAdminToken(t) { localStorage.setItem('adminToken', t); }
function clearAdminToken() { localStorage.removeItem('adminToken'); }

async function api(path, options = {}) {
  const token = getAdminToken();
  const res = await fetch('/api/admin' + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) { clearAdminToken(); showLogin(); }
    throw new Error(data.error || 'حدث خطأ');
  }
  return data;
}

function flash(msg, type = 'success') {
  const box = $('msgBox');
  box.innerHTML = `<div class="${type === 'success' ? 'success-box' : 'error-box'}">${escapeHtml(msg)}</div>`;
  setTimeout(() => { box.innerHTML = ''; }, 3500);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function showLogin() {
  $('loginView').classList.remove('hidden');
  $('dashView').classList.add('hidden');
}

function showDashboard(username) {
  $('loginView').classList.add('hidden');
  $('dashView').classList.remove('hidden');
  $('whoami').textContent = username || '';
  loadCategories();
  loadQuestions();
  loadColumns();
  loadCases();
  loadAdmins();
  loadShopUsers('');
  loadShopPayments();
}

// ===== تسجيل الدخول =====
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginMsg').innerHTML = '';
  try {
    const data = await api('/login', {
      method: 'POST',
      body: JSON.stringify({
        username: $('loginUsername').value.trim(),
        password: $('loginPassword').value
      })
    });
    setAdminToken(data.token);
    showDashboard(data.username);
  } catch (err) {
    $('loginMsg').innerHTML = `<div class="error-box">${escapeHtml(err.message)}</div>`;
  }
});

$('logoutBtn').addEventListener('click', () => {
  clearAdminToken();
  showLogin();
});

// ===== التبويبات =====
document.querySelectorAll('.tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    $('tab-' + btn.dataset.tab).classList.remove('hidden');
  });
});

// ===================== الفئات =====================
async function loadCategories() {
  try {
    const categories = await api('/categories');
    const wrap = $('categoriesList');
    if (categories.length === 0) {
      wrap.innerHTML = '<p class="muted">ما فيه أقسام بعد.</p>';
      return;
    }
    wrap.innerHTML = categories.map(cat => `
      <div class="card">
        <div class="cat-header" data-toggle="${cat.id}">
          <strong>${escapeHtml(cat.name)}</strong><span class="chip">${cat.words.length} كلمة</span>
          <span class="chip" style="${cat.is_free ? '' : 'background:rgba(193,68,60,0.15);color:var(--red);'}">${cat.is_free ? 'مجانية' : 'مدفوعة'}</span>
          <span class="arrow">▾</span>
        </div>
        <div class="cat-body" id="cat-body-${cat.id}">
          <div class="row">
            <input type="text" id="rename-${cat.id}" value="${escapeHtml(cat.name)}">
            <label style="display:flex;align-items:center;gap:6px;width:auto;white-space:nowrap;margin:0;">
              <input type="checkbox" id="free-${cat.id}" style="width:auto;margin:0;" ${cat.is_free ? 'checked' : ''}> مجانية
            </label>
            <button class="btn-sm" data-rename="${cat.id}">حفظ</button>
            <button class="btn-sm btn-danger" data-delcat="${cat.id}">حذف القسم</button>
          </div>
          <div class="row" style="margin-top:10px;">
            <input type="text" id="newword-${cat.id}" placeholder="كلمة جديدة">
            <button class="btn-sm btn-primary" data-addword="${cat.id}">إضافة</button>
          </div>
          <div class="words-wrap">
            ${cat.words.map(w => `
              <span class="word-chip">${escapeHtml(w.word)}<button data-delword="${w.id}">✕</button></span>
            `).join('')}
          </div>
        </div>
      </div>
    `).join('');

    wrap.querySelectorAll('[data-toggle]').forEach(el => {
      el.addEventListener('click', () => {
        $('cat-body-' + el.dataset.toggle).classList.toggle('open');
      });
    });
    wrap.querySelectorAll('[data-rename]').forEach(el => {
      el.addEventListener('click', async () => {
        const id = el.dataset.rename;
        try {
          await api(`/categories/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ name: $('rename-' + id).value.trim(), is_free: $('free-' + id).checked })
          });
          flash('تم التحديث');
          loadCategories();
        } catch (err) { flash(err.message, 'error'); }
      });
    });
    wrap.querySelectorAll('[data-delcat]').forEach(el => {
      el.addEventListener('click', async () => {
        if (!confirm('حذف القسم بكل كلماته؟')) return;
        try {
          await api(`/categories/${el.dataset.delcat}`, { method: 'DELETE' });
          flash('تم حذف القسم');
          loadCategories();
        } catch (err) { flash(err.message, 'error'); }
      });
    });
    wrap.querySelectorAll('[data-addword]').forEach(el => {
      el.addEventListener('click', async () => {
        const id = el.dataset.addword;
        const input = $('newword-' + id);
        const word = input.value.trim();
        if (!word) return;
        try {
          await api(`/categories/${id}/words`, { method: 'POST', body: JSON.stringify({ word }) });
          input.value = '';
          loadCategories();
        } catch (err) { flash(err.message, 'error'); }
      });
    });
    wrap.querySelectorAll('[data-delword]').forEach(el => {
      el.addEventListener('click', async () => {
        try {
          await api(`/words/${el.dataset.delword}`, { method: 'DELETE' });
          loadCategories();
        } catch (err) { flash(err.message, 'error'); }
      });
    });
  } catch (err) { flash(err.message, 'error'); }
}

$('addCategoryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('newCategoryName').value.trim();
  if (!name) return;
  try {
    await api('/categories', { method: 'POST', body: JSON.stringify({ name, is_free: $('newCategoryFree').checked }) });
    $('newCategoryName').value = '';
    $('newCategoryFree').checked = false;
    flash('تمت إضافة القسم');
    loadCategories();
  } catch (err) { flash(err.message, 'error'); }
});

// ===================== العامل المشترك =====================
async function loadQuestions() {
  try {
    const questions = await api('/common-factor');
    const wrap = $('questionsList');
    if (questions.length === 0) {
      wrap.innerHTML = '<p class="muted">ما فيه أسئلة بعد.</p>';
      return;
    }
    wrap.innerHTML = questions.map(q => `
      <div class="q-item">
        <div class="q-items">${escapeHtml(q.items.join(' / '))} <span class="chip">مستوى ${q.level}</span></div>
        <div class="q-choices">الخيارات: ${escapeHtml(q.choices.join(' - '))}</div>
        <div class="q-answer">الإجابة: ${escapeHtml(q.answer)}</div>
        <div class="q-actions">
          <button class="btn-sm btn-danger" data-delq="${q.id}">حذف</button>
        </div>
      </div>
    `).join('');
    wrap.querySelectorAll('[data-delq]').forEach(el => {
      el.addEventListener('click', async () => {
        if (!confirm('حذف هذا السؤال؟')) return;
        try {
          await api(`/common-factor/${el.dataset.delq}`, { method: 'DELETE' });
          loadQuestions();
        } catch (err) { flash(err.message, 'error'); }
      });
    });
  } catch (err) { flash(err.message, 'error'); }
}

$('addQuestionForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const items = $('qItems').value.split(',').map(s => s.trim()).filter(Boolean);
  const choices = $('qChoices').value.split(',').map(s => s.trim()).filter(Boolean);
  const answer = $('qAnswer').value.trim();
  try {
    await api('/common-factor', {
      method: 'POST',
      body: JSON.stringify({ level: Number($('qLevel').value), items, choices, answer })
    });
    e.target.reset();
    flash('تمت إضافة السؤال');
    loadQuestions();
  } catch (err) { flash(err.message, 'error'); }
});

// ===================== خانات لعبة الحروف =====================
async function loadColumns() {
  try {
    const columns = await api('/letters-columns');
    const wrap = $('columnsList');
    if (columns.length === 0) {
      wrap.innerHTML = '<p class="muted">ما فيه خانات بعد.</p>';
      return;
    }
    wrap.innerHTML = columns.map(c => `
      <div class="list-item">
        <div class="grow">
          <strong>${c.emoji || ''} ${escapeHtml(c.label)}</strong>
          <div class="meta">المعرف: ${escapeHtml(c.col_key)} ${c.is_default ? '<span class="chip">افتراضية</span>' : ''}</div>
        </div>
        <button class="btn-sm btn-danger" data-delcol="${c.id}">حذف</button>
      </div>
    `).join('');
    wrap.querySelectorAll('[data-delcol]').forEach(el => {
      el.addEventListener('click', async () => {
        if (!confirm('حذف هذي الخانة؟')) return;
        try {
          await api(`/letters-columns/${el.dataset.delcol}`, { method: 'DELETE' });
          loadColumns();
        } catch (err) { flash(err.message, 'error'); }
      });
    });
  } catch (err) { flash(err.message, 'error'); }
}

$('addColumnForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/letters-columns', {
      method: 'POST',
      body: JSON.stringify({
        col_key: $('colKey').value.trim(),
        label: $('colLabel').value.trim(),
        emoji: $('colEmoji').value.trim(),
        is_default: $('colDefault').checked
      })
    });
    e.target.reset();
    flash('تمت إضافة الخانة');
    loadColumns();
  } catch (err) { flash(err.message, 'error'); }
});

// ===================== قصة جنائية =====================
async function loadCases() {
  try {
    const cases = await api('/detective-cases');
    const wrap = $('casesList');
    if (cases.length === 0) {
      wrap.innerHTML = '<p class="muted">ما فيه قضايا بعد.</p>';
      return;
    }
    const levelLabel = { 1: 'سهل', 2: 'متوسط', 3: 'صعب' };
    wrap.innerHTML = cases.map(c => `
      <div class="q-item">
        <div class="q-items">${escapeHtml(c.story)} <span class="chip">${levelLabel[c.level] || c.level}</span></div>
        <div class="q-choices">الخيارات: ${escapeHtml(c.choices.join(' - '))}</div>
        <div class="q-answer">الإجابة: ${escapeHtml(c.answer)}</div>
        <div class="q-actions">
          <button class="btn-sm btn-danger" data-delcase="${c.id}">حذف</button>
        </div>
      </div>
    `).join('');
    wrap.querySelectorAll('[data-delcase]').forEach(el => {
      el.addEventListener('click', async () => {
        if (!confirm('حذف هذي القضية؟')) return;
        try {
          await api(`/detective-cases/${el.dataset.delcase}`, { method: 'DELETE' });
          loadCases();
        } catch (err) { flash(err.message, 'error'); }
      });
    });
  } catch (err) { flash(err.message, 'error'); }
}

$('addCaseForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const choices = $('caseChoices').value.split(',').map(s => s.trim()).filter(Boolean);
  const answer = $('caseAnswer').value.trim();
  try {
    await api('/detective-cases', {
      method: 'POST',
      body: JSON.stringify({
        level: Number($('caseLevel').value),
        story: $('caseStory').value.trim(),
        choices,
        answer
      })
    });
    e.target.reset();
    flash('تمت إضافة القضية');
    loadCases();
  } catch (err) { flash(err.message, 'error'); }
});

// ===================== المتجر =====================
const UNLOCK_LABELS = {
  all_categories: 'كل فئات لمّة',
  all_cases: 'كل قضايا التحري',
  mafia: 'لعبة المافيا',
  remove_ads: 'إزالة الإعلانات',
  category: 'فئة رقم',
  case: 'قضية رقم'
};

function unlockChipLabel(u) {
  const base = UNLOCK_LABELS[u.item_type] || u.item_type;
  return (u.item_type === 'category' || u.item_type === 'case') ? `${base} ${u.item_id}` : base;
}

async function loadShopUsers(query) {
  try {
    const q = query !== undefined ? query : $('shopUserSearch').value.trim();
    const users = await api('/shop/users?q=' + encodeURIComponent(q));
    const wrap = $('shopUsersList');
    if (users.length === 0) {
      wrap.innerHTML = '<p class="muted">ما فيه نتائج.</p>';
      return;
    }
    wrap.innerHTML = users.map(u => `
      <div class="card">
        <div class="row" style="justify-content:space-between;">
          <div><strong>${escapeHtml(u.username)}</strong> <span class="muted">${escapeHtml(u.email)}</span></div>
          <div class="chip">🪙 ${u.coins} كوين</div>
        </div>

        <div class="row" style="margin-top:10px;">
          <input type="number" id="coins-amount-${u.id}" placeholder="مثال: 50 أو -20 (خصم)">
          <input type="text" id="coins-reason-${u.id}" placeholder="السبب (مثال: تعويض دفعة فشلت)">
          <button class="btn-sm" data-grantcoins="${u.id}" style="width:auto;">تعديل الرصيد</button>
        </div>

        <div class="row" style="margin-top:10px;">
          <div class="grow muted">
            الاشتراك: ${u.subscriptionActive ? `فعّال حتى ${new Date(u.subscriptionPeriodEnd * 1000).toLocaleDateString('ar-SA')}` : 'غير مفعّل'}
          </div>
          <button class="btn-sm btn-primary" data-grantsub="${u.id}" style="width:auto;">منح 30 يوم</button>
          ${u.subscriptionActive ? `<button class="btn-sm btn-danger" data-revokesub="${u.id}" style="width:auto;">إلغاء</button>` : ''}
        </div>

        <div class="words-wrap" style="margin-top:10px;">
          ${u.unlocks.map(un => `
            <span class="word-chip">${escapeHtml(unlockChipLabel(un))}<button data-revokeunlock="${u.id}" data-type="${un.item_type}" data-itemid="${un.item_id ?? ''}">✕</button></span>
          `).join('') || '<span class="muted">ما فيه عناصر مفتوحة</span>'}
        </div>

        <div class="row" style="margin-top:10px;flex-wrap:wrap;">
          <button class="btn-sm" data-grantunlock="${u.id}" data-type="all_categories" style="width:auto;">+ كل الفئات</button>
          <button class="btn-sm" data-grantunlock="${u.id}" data-type="all_cases" style="width:auto;">+ كل القضايا</button>
          <button class="btn-sm" data-grantunlock="${u.id}" data-type="mafia" style="width:auto;">+ المافيا</button>
          <button class="btn-sm" data-grantunlock="${u.id}" data-type="remove_ads" style="width:auto;">+ إزالة الإعلانات</button>
        </div>
      </div>
    `).join('');

    wrap.querySelectorAll('[data-grantcoins]').forEach(el => {
      el.addEventListener('click', async () => {
        const id = el.dataset.grantcoins;
        const amount = Number($('coins-amount-' + id).value);
        const reason = $('coins-reason-' + id).value.trim();
        if (!amount) return flash('اكتب رقم غير صفر', 'error');
        if (!reason) return flash('لازم تكتب سبب التعديل', 'error');
        try {
          await api('/shop/grant-coins', { method: 'POST', body: JSON.stringify({ userId: Number(id), amount, reason }) });
          flash('تم تعديل الرصيد');
          loadShopUsers();
        } catch (err) { flash(err.message, 'error'); }
      });
    });

    wrap.querySelectorAll('[data-grantsub]').forEach(el => {
      el.addEventListener('click', async () => {
        try {
          await api('/shop/grant-subscription', { method: 'POST', body: JSON.stringify({ userId: Number(el.dataset.grantsub), days: 30 }) });
          flash('تم منح الاشتراك');
          loadShopUsers();
        } catch (err) { flash(err.message, 'error'); }
      });
    });

    wrap.querySelectorAll('[data-revokesub]').forEach(el => {
      el.addEventListener('click', async () => {
        if (!confirm('إلغاء اشتراك هذا المستخدم؟')) return;
        try {
          await api('/shop/revoke-subscription', { method: 'POST', body: JSON.stringify({ userId: Number(el.dataset.revokesub) }) });
          flash('تم إلغاء الاشتراك');
          loadShopUsers();
        } catch (err) { flash(err.message, 'error'); }
      });
    });

    wrap.querySelectorAll('[data-grantunlock]').forEach(el => {
      el.addEventListener('click', async () => {
        try {
          await api('/shop/grant-unlock', { method: 'POST', body: JSON.stringify({ userId: Number(el.dataset.grantunlock), itemType: el.dataset.type }) });
          flash('تم منح العنصر');
          loadShopUsers();
        } catch (err) { flash(err.message, 'error'); }
      });
    });

    wrap.querySelectorAll('[data-revokeunlock]').forEach(el => {
      el.addEventListener('click', async () => {
        if (!confirm('سحب هذا العنصر من المستخدم؟')) return;
        try {
          await api('/shop/revoke-unlock', {
            method: 'POST',
            body: JSON.stringify({
              userId: Number(el.dataset.revokeunlock),
              itemType: el.dataset.type,
              itemId: el.dataset.itemid ? Number(el.dataset.itemid) : null
            })
          });
          flash('تم السحب');
          loadShopUsers();
        } catch (err) { flash(err.message, 'error'); }
      });
    });
  } catch (err) { flash(err.message, 'error'); }
}

$('btnShopSearch').addEventListener('click', () => loadShopUsers());
$('shopUserSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); loadShopUsers(); } });

async function loadShopPayments() {
  try {
    const rows = await api('/shop/payments');
    const wrap = $('shopPaymentsList');
    if (rows.length === 0) {
      wrap.innerHTML = '<p class="muted">ما فيه مدفوعات بعد.</p>';
      return;
    }
    const statusLabel = { paid: 'مدفوعة ✅', initiated: 'بانتظار الدفع ⏳', failed: 'فشلت ❌' };
    wrap.innerHTML = rows.map(p => `
      <div class="list-item">
        <div class="grow">
          <strong>${escapeHtml(p.username)}</strong> — ${escapeHtml(p.reference)}
          <div class="meta">${(p.amount_halalas / 100).toFixed(2)} ريال — ${new Date(p.created_at * 1000).toLocaleString('ar-SA')}</div>
        </div>
        <span class="chip">${statusLabel[p.status] || p.status}</span>
      </div>
    `).join('');
  } catch (err) { flash(err.message, 'error'); }
}

// ===================== المشرفين =====================
async function loadAdmins() {
  try {
    const admins = await api('/admins');
    const wrap = $('adminsList');
    wrap.innerHTML = admins.map(a => `
      <div class="list-item">
        <div class="grow"><strong>${escapeHtml(a.username)}</strong></div>
        <button class="btn-sm btn-danger" data-deladmin="${a.id}">حذف</button>
      </div>
    `).join('');
    wrap.querySelectorAll('[data-deladmin]').forEach(el => {
      el.addEventListener('click', async () => {
        if (!confirm('حذف هذا المشرف؟')) return;
        try {
          await api(`/admins/${el.dataset.deladmin}`, { method: 'DELETE' });
          loadAdmins();
        } catch (err) { flash(err.message, 'error'); }
      });
    });
  } catch (err) { flash(err.message, 'error'); }
}

$('addAdminForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/admins', {
      method: 'POST',
      body: JSON.stringify({
        username: $('newAdminUsername').value.trim(),
        password: $('newAdminPassword').value
      })
    });
    e.target.reset();
    flash('تمت إضافة المشرف');
    loadAdmins();
  } catch (err) { flash(err.message, 'error'); }
});

// ===== نقطة البداية =====
(async function init() {
  const token = getAdminToken();
  if (!token) { showLogin(); return; }
  try {
    const me = await api('/me');
    showDashboard(me.username);
  } catch (e) {
    showLogin();
  }
})();
