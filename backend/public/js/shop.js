// ===================== واجهة متجر "لمّة كوين" =====================

let shopConfig = null; // { coinPackages, prices, subscription }
window.shopAccess = null; // آخر نسخة من صلاحيات المستخدم (تستخدمها ملفات ثانية زي mafia.js)
let cart = [];          // [{ type: 'coins', packageId, priceSAR, label } | { type: 'subscription', priceSAR, label }]
let appliedCoupon = null; // { code, type, value, label } آخر كوبون اتحقق منه بنجاح

async function apiGet(url) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error((await res.json()).error || 'خطأ بالسيرفر');
  return res.json();
}

async function apiPost(url, body) {
  const token = getToken();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    },
    body: JSON.stringify(body || {})
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || 'خطأ بالسيرفر'), { data });
  return data;
}

async function loadShopConfig() {
  if (!shopConfig) shopConfig = await apiGet('/api/shop/config');
  return shopConfig;
}

// تُستدعى بعد تسجيل الدخول وعند فتح المتجر — تحدّث window.shopAccess وتخفي الإعلانات للمستحقين
async function refreshShopAccess() {
  if (!currentUser) { window.shopAccess = null; updateHeaderCoinBadge(null); return null; }
  try {
    const wallet = await apiGet('/api/shop/wallet');
    window.shopAccess = wallet;
    applyAdsVisibility();
    updateHeaderCoinBadge(wallet);
    return wallet;
  } catch (e) {
    return null;
  }
}

// ===== بادج الكوينز بالهيدر (أيقونة السلة/المتجر) =====
function updateHeaderCoinBadge(wallet) {
  const badge = document.getElementById('header-coin-badge');
  if (!badge) return;
  if (wallet && currentUser) {
    badge.textContent = wallet.coins > 999 ? '999+' : wallet.coins;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// يحدّث الرصيد تلقائياً لما المستخدم يرجع لتبويب الموقع (مثلاً بعد إتمام الدفع عند Moyasar)
window.addEventListener('focus', () => {
  if (typeof currentUser !== 'undefined' && currentUser) refreshShopAccess();
});

function applyAdsVisibility() {
  const shouldHide = !!(window.shopAccess && (window.shopAccess.hasRemoveAds || window.shopAccess.subscriptionActive));
  document.querySelectorAll('.ad-slot').forEach(el => {
    el.classList.toggle('hidden', shouldHide);
  });
}

// ===================== شاشة المتجر =====================
async function startShopMode() {
  show('view-shop');
  hide('shop-logged-out');
  hide('shop-logged-in');
  $('shop-message').innerHTML = '';

  if (!currentUser) {
    show('shop-logged-out');
    return;
  }

  show('shop-logged-in');
  await loadShopConfig();
  await renderShop();
}

async function renderShop() {
  try {
    const [wallet, catStatus, caseStatus] = await Promise.all([
      refreshShopAccess(),
      apiGet('/api/categories-status'),
      apiGet('/api/detective-cases-status')
    ]);

    renderWalletBar(wallet);
    renderPackages();
    renderSubscriptionCard(wallet);
    renderOnlinePlayCard(wallet);
    renderUnlockList('shop-categories-list', catStatus, 'category', shopConfig.prices.category_single, c => c.name);
    renderUnlockList('shop-cases-list', caseStatus, 'case', shopConfig.prices.case_single, c => `قضية مستوى ${c.level} #${c.id}`);
    renderAllButtons(wallet);
    renderExtraButtons(wallet);
    renderCart();
  } catch (e) {
    $('shop-message').innerHTML = `<div class="error-box">${e.message}</div>`;
  }
}

function renderWalletBar(wallet) {
  $('shop-coin-balance').textContent = wallet ? wallet.coins : '—';
  const subEl = $('shop-sub-status');
  if (wallet && wallet.subscriptionActive) {
    const endDate = wallet.subscriptionPeriodEnd ? new Date(wallet.subscriptionPeriodEnd * 1000).toLocaleDateString('ar-SA') : '';
    subEl.innerHTML = `<div class="success-box">👑 اشتراك لمّة بلس فعّال${endDate ? ' حتى ' + endDate : ''}</div>`;
  } else {
    subEl.innerHTML = '';
  }
}

function renderPackages() {
  const wrap = $('shop-packages');
  wrap.innerHTML = '';
  shopConfig.coinPackages.forEach(pkg => {
    const card = document.createElement('div');
    card.className = 'shop-card';
    card.innerHTML = `
      <div class="shop-card-title">${pkg.coins} 🪙</div>
      <div class="shop-card-note">${pkg.label}</div>
      <button class="btn-primary shop-buy-btn">أضف للسلة — ${pkg.priceSAR} ريال</button>
    `;
    card.querySelector('button').addEventListener('click', () => addToCart('coins', pkg.id));
    wrap.appendChild(card);
  });
}

function renderSubscriptionCard(wallet) {
  const wrap = $('shop-subscription-card');
  wrap.innerHTML = '';
  const sub = shopConfig.subscription;
  const card = document.createElement('div');
  card.className = 'shop-card shop-card-wide';
  const already = wallet && wallet.subscriptionActive;
  const inCart = cart.some(i => i.type === 'subscription');
  card.innerHTML = `
    <div class="shop-card-title">${sub.label}</div>
    <div class="shop-card-note">كل الفئات + كل القضايا + المافيا + بدون إعلانات + ${sub.monthlyGiftCoins} كوين هدية كل شهر</div>
    <button class="btn-primary shop-buy-btn" ${already || inCart ? 'disabled' : ''}>${already ? 'مفعّل حالياً ✅' : inCart ? 'بالسلة ✅' : 'أضف للسلة — ' + sub.priceSAR + ' ريال / شهرياً'}</button>
  `;
  if (!already && !inCart) {
    card.querySelector('button').addEventListener('click', () => addToCart('subscription'));
  }
  wrap.appendChild(card);
}

function renderOnlinePlayCard(wallet) {
  const wrap = $('shop-online-play-card');
  wrap.innerHTML = '';
  const op = shopConfig.onlinePlay;
  const card = document.createElement('div');
  card.className = 'shop-card shop-card-wide';
  const already = wallet && wallet.hasOnlinePlay;
  const inCart = cart.some(i => i.type === 'online_play');
  card.innerHTML = `
    <div class="shop-card-title">${op.label}</div>
    <div class="shop-card-note">افتحها مرة وحدة، وتقدر بعدها تسوي غرف أونلاين مع كل فئات لمّة مفتوحة تلقائياً</div>
    <button class="btn-primary shop-buy-btn" ${already || inCart ? 'disabled' : ''}>${already ? 'مفعّلة ✅' : inCart ? 'بالسلة ✅' : 'أضف للسلة — ' + op.priceSAR + ' ريال'}</button>
  `;
  if (!already && !inCart) {
    card.querySelector('button').addEventListener('click', () => addToCart('online_play'));
  }
  wrap.appendChild(card);
}

function renderUnlockList(containerId, items, itemType, price, labelFn) {
  const wrap = $(containerId);
  wrap.innerHTML = '';
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'shop-unlock-row';
    row.innerHTML = `
      <span>${labelFn(item)}${item.unlocked ? ' <span class="tag">مفتوح</span>' : ''}</span>
      <button class="btn-primary shop-buy-btn" ${item.unlocked ? 'disabled' : ''}>${item.unlocked ? '✅' : price + ' 🪙'}</button>
    `;
    if (!item.unlocked) {
      row.querySelector('button').addEventListener('click', () => unlockItem(itemType, item.id));
    }
    wrap.appendChild(row);
  });
}

function renderAllButtons(wallet) {
  const allCatsBtn = $('btn-shop-unlock-all-categories');
  const allCasesBtn = $('btn-shop-unlock-all-cases');
  const hasAllCats = wallet && wallet.hasAllCategories;
  const hasAllCases = wallet && wallet.hasAllCases;

  allCatsBtn.textContent = hasAllCats ? '✅ كل الفئات مفتوحة' : `فتح كل الفئات دفعة وحدة — ${shopConfig.prices.category_all} 🪙`;
  allCatsBtn.disabled = hasAllCats;
  allCatsBtn.onclick = hasAllCats ? null : () => unlockItem('all_categories', null);

  allCasesBtn.textContent = hasAllCases ? '✅ كل القضايا مفتوحة' : `فتح كل القضايا دفعة وحدة — ${shopConfig.prices.case_all} 🪙`;
  allCasesBtn.disabled = hasAllCases;
  allCasesBtn.onclick = hasAllCases ? null : () => unlockItem('all_cases', null);
}

function renderExtraButtons(wallet) {
  const mafiaBtn = $('btn-shop-unlock-mafia');
  const adsBtn = $('btn-shop-unlock-ads');
  const hasMafia = wallet && wallet.hasMafia;
  const hasRemoveAds = wallet && wallet.hasRemoveAds;

  mafiaBtn.textContent = hasMafia ? '✅ مفتوحة' : `${shopConfig.prices.mafia} 🪙`;
  mafiaBtn.disabled = hasMafia;
  mafiaBtn.onclick = hasMafia ? null : () => unlockItem('mafia', null);

  adsBtn.textContent = hasRemoveAds ? '✅ مفعّل' : `${shopConfig.prices.remove_ads} 🪙`;
  adsBtn.disabled = hasRemoveAds;
  adsBtn.onclick = hasRemoveAds ? null : () => unlockItem('remove_ads', null);
}

async function unlockItem(itemType, itemId) {
  $('shop-message').innerHTML = '';
  try {
    await apiPost('/api/shop/unlock', { itemType, itemId });
    $('shop-message').innerHTML = `<div class="success-box">تم الفتح بنجاح ✅</div>`;
    await renderShop();
  } catch (e) {
    const needed = e.data && e.data.needed;
    const msg = needed ? `رصيدك ما يكفي، تحتاج ${needed} كوين. اشحن رصيدك من الأعلى.` : e.message;
    $('shop-message').innerHTML = `<div class="error-box">${msg}</div>`;
  }
}

// ===================== إدارة السلة =====================
function addToCart(type, packageId) {
  if (type === 'subscription') {
    if (cart.some(i => i.type === 'subscription')) return; // موجود بالسلة مسبقاً
    cart.push({ type: 'subscription', priceSAR: shopConfig.subscription.priceSAR, label: shopConfig.subscription.label });
  } else if (type === 'online_play') {
    if (cart.some(i => i.type === 'online_play')) return; // موجود بالسلة مسبقاً
    cart.push({ type: 'online_play', priceSAR: shopConfig.onlinePlay.priceSAR, label: shopConfig.onlinePlay.label });
  } else if (type === 'coins') {
    const pkg = shopConfig.coinPackages.find(p => p.id === packageId);
    if (!pkg) return;
    cart.push({ type: 'coins', packageId: pkg.id, priceSAR: pkg.priceSAR, label: `${pkg.coins} 🪙 — ${pkg.label}` });
  }
  renderSubscriptionCard(window.shopAccess);
  renderOnlinePlayCard(window.shopAccess);
  renderCart();
}

function removeFromCart(index) {
  cart.splice(index, 1);
  renderSubscriptionCard(window.shopAccess);
  renderOnlinePlayCard(window.shopAccess);
  renderCart();
}

function cartSubtotal() {
  return cart.reduce((sum, i) => sum + i.priceSAR, 0);
}

function cartDiscount() {
  if (!appliedCoupon) return 0;
  const subtotal = cartSubtotal();
  const raw = appliedCoupon.type === 'percent' ? (subtotal * appliedCoupon.value / 100) : appliedCoupon.value;
  return Math.min(Math.max(raw, 0), subtotal);
}

function renderCart() {
  const bar = $('shop-cart-bar');
  const list = $('shop-cart-items');
  list.innerHTML = '';

  if (cart.length === 0) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');

  cart.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'shop-cart-row';
    row.innerHTML = `
      <span>${item.label}</span>
      <span>${item.priceSAR} ريال</span>
      <button type="button" class="shop-cart-remove">✕</button>
    `;
    row.querySelector('button').addEventListener('click', () => removeFromCart(i));
    list.appendChild(row);
  });

  const subtotal = cartSubtotal();
  const discount = cartDiscount();
  const total = Math.max(subtotal - discount, 0.5);

  const discountLine = $('shop-cart-discount-line');
  if (discount > 0) {
    discountLine.classList.remove('hidden');
    discountLine.textContent = `خصم الكوبون (${appliedCoupon.label}): -${discount.toFixed(2)} ريال`;
  } else {
    discountLine.classList.add('hidden');
  }

  $('shop-cart-total-amount').textContent = total.toFixed(2);
}

document.getElementById('btn-shop-apply-coupon').addEventListener('click', async () => {
  const input = document.getElementById('shop-coupon-input');
  const code = input.value.trim();
  const msgEl = document.getElementById('shop-coupon-message');
  msgEl.innerHTML = '';
  if (!code) return;

  try {
    const coupon = await apiPost('/api/shop/validate-coupon', { code });
    appliedCoupon = coupon;
    msgEl.innerHTML = `<span style="color:var(--green);">تم تطبيق كود الخصم: ${coupon.label} ✅</span>`;
    renderCart();
  } catch (e) {
    appliedCoupon = null;
    msgEl.innerHTML = `<span style="color:var(--red);">${e.message}</span>`;
    renderCart();
  }
});

document.getElementById('btn-shop-checkout-cart').addEventListener('click', async () => {
  if (cart.length === 0) return;
  $('shop-message').innerHTML = `<div class="center-note">يتم تجهيز صفحة الدفع...</div>`;
  try {
    const items = cart.map(i => {
      if (i.type === 'coins') return { kind: 'coins', packageId: i.packageId };
      if (i.type === 'online_play') return { kind: 'online_play' };
      return { kind: 'subscription' };
    });
    const body = { items };
    if (appliedCoupon) body.couponCode = appliedCoupon.code;

    const { url, invoiceId } = await apiPost('/api/shop/checkout', body);
    if (invoiceId) sessionStorage.setItem('lamma_pending_invoice', invoiceId);
    location.href = url; // تحويل المستخدم لصفحة الدفع المستضافة عند Moyasar
  } catch (e) {
    $('shop-message').innerHTML = `<div class="error-box">${e.message}</div>`;
  }
});

document.getElementById('btn-shop-back-home').addEventListener('click', () => {
  hide('view-shop');
  show('view-home');
});

document.getElementById('btn-shop-goto-login').addEventListener('click', () => {
  hide('view-shop');
  show('view-auth');
});

// ===== لو رجع المستخدم من صفحة دفع Moyasar بنجاح =====
(function handleShopReturn() {
  const params = new URLSearchParams(location.search);
  if (params.get('shop') === 'success') {
    history.replaceState({}, '', location.pathname);
    // ينتظر تسجيل الدخول (init بـ app.js) قبل ما يفتح المتجر ويتحقق من الدفع
    const tryOpen = () => {
      if (typeof currentUser !== 'undefined' && currentUser) {
        startShopMode();
        verifyPendingPayment();
      } else {
        setTimeout(tryOpen, 400);
      }
    };
    setTimeout(tryOpen, 300);
  }
})();

// يتأكد من نتيجة آخر عملية دفع مباشرة من Moyasar (بدل الاعتماد فقط على الـ webhook،
// اللي ما يوصل أبداً لو السيرفر شغّال محلياً بدون رابط عام Moyasar تقدر توصله)
async function verifyPendingPayment(attempt) {
  const invoiceId = sessionStorage.getItem('lamma_pending_invoice');
  if (!invoiceId) return;

  attempt = attempt || 1;
  $('shop-message').innerHTML = `<div class="center-note">يتم التأكد من عملية الدفع...</div>`;

  try {
    const { status } = await apiPost('/api/shop/verify', { invoiceId });
    if (status === 'paid') {
      sessionStorage.removeItem('lamma_pending_invoice');
      $('shop-message').innerHTML = `<div class="success-box">تم الدفع بنجاح ✅</div>`;
      await renderShop();
    } else if (attempt < 6) {
      // الدفع لسا ما انعكس عند Moyasar، نعيد المحاولة كل شوي (البنوك أحياناً تتأخر ثواني)
      setTimeout(() => verifyPendingPayment(attempt + 1), 2500);
    } else {
      $('shop-message').innerHTML = `<div class="error-box">الدفع لسا قيد المعالجة، جرّب تحدّث الصفحة بعد دقيقة.</div>`;
    }
  } catch (e) {
    $('shop-message').innerHTML = `<div class="error-box">${e.message}</div>`;
  }
}
