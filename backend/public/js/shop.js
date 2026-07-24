// ===================== واجهة متجر "لمّة كوين" =====================

let shopConfig = null; // { coinPackages, prices, subscription }
window.shopAccess = null; // آخر نسخة من صلاحيات المستخدم (تستخدمها ملفات ثانية زي mafia.js)

// ===== حالة السلة (تُحفظ بالمتصفح لحد ما تسوّي دفع) =====
let cart = [];
try { cart = JSON.parse(sessionStorage.getItem('lamma_cart') || '[]'); } catch (e) { cart = []; }

function saveCart() {
  try { sessionStorage.setItem('lamma_cart', JSON.stringify(cart)); } catch (e) { /* تجاهل */ }
  updateCartFloatBadge();
}

function cartQtyFor(kind, packageId) {
  const line = cart.find(l => l.kind === kind && l.packageId === packageId);
  return line ? line.qty : 0;
}

function addToCart(kind, packageId, qty) {
  qty = Math.max(1, qty || 1);
  const existing = cart.find(l => l.kind === kind && l.packageId === packageId);
  if (kind === 'subscription') {
    if (!existing) cart.push({ kind, packageId: null, qty: 1 });
  } else if (existing) {
    existing.qty = qty;
    if (existing.qty <= 0) cart = cart.filter(l => l !== existing);
  } else if (qty > 0) {
    cart.push({ kind, packageId, qty });
  }
  saveCart();
}

function removeFromCart(index) {
  cart.splice(index, 1);
  saveCart();
  renderCartPanel();
}

function cartLinePrice(line) {
  if (line.kind === 'subscription') return shopConfig.subscription.priceSAR;
  const pkg = findPkgById(line.packageId);
  return pkg ? pkg.priceSAR * line.qty : 0;
}

function cartLineLabel(line) {
  if (line.kind === 'subscription') return shopConfig.subscription.label + ' (شهري)';
  const pkg = findPkgById(line.packageId);
  return pkg ? `${pkg.coins} كوين` : '';
}

function findPkgById(id) {
  return shopConfig && shopConfig.coinPackages.find(p => p.id === id);
}

function updateCartFloatBadge() {
  const btn = document.getElementById('btn-cart-float');
  const count = document.getElementById('cart-float-count');
  if (!btn || !count) return;
  const totalQty = cart.reduce((s, l) => s + l.qty, 0);
  if (totalQty > 0 && currentUser) {
    btn.classList.remove('hidden');
    count.textContent = totalQty;
    count.classList.remove('hidden');
  } else {
    btn.classList.add('hidden');
  }
}

function renderCartPanel() {
  const wrap = document.getElementById('cart-items');
  const totalEl = document.getElementById('cart-total');
  if (!wrap || !totalEl) return;

  if (cart.length === 0) {
    wrap.innerHTML = '<div class="cart-empty-note">السلة فاضية — ضيف باقة كوينز أو اشتراك</div>';
    totalEl.textContent = '0 ريال';
    return;
  }

  let total = 0;
  wrap.innerHTML = cart.map((line, idx) => {
    const price = cartLinePrice(line);
    total += price;
    const qtyControls = line.kind === 'coins'
      ? `<div class="shop-qty-controls">
           <button type="button" onclick="changeCartQty(${idx}, -1)">−</button>
           <span>${line.qty}</span>
           <button type="button" onclick="changeCartQty(${idx}, 1)">+</button>
         </div>`
      : '';
    return `
      <div class="cart-item-row">
        <div>
          <div class="cart-item-name">${cartLineLabel(line)}</div>
          <div class="cart-item-note">${price} ريال${line.kind === 'coins' ? ` (${line.qty} × ${findPkgById(line.packageId)?.priceSAR} ريال)` : ''}</div>
          ${qtyControls}
        </div>
        <button type="button" class="cart-item-remove" onclick="removeFromCart(${idx})">🗑️</button>
      </div>
    `;
  }).join('');

  totalEl.textContent = total + ' ريال';
}

function changeCartQty(idx, delta) {
  const line = cart[idx];
  if (!line) return;
  line.qty += delta;
  if (line.qty <= 0) cart.splice(idx, 1);
  saveCart();
  renderCartPanel();
  if (shopConfig) { renderPackages(); }
}

function openCartPanel() {
  renderCartPanel();
  document.getElementById('cart-overlay').classList.remove('hidden');
  document.getElementById('cart-panel').classList.remove('hidden');
}

function closeCartPanel() {
  document.getElementById('cart-overlay').classList.add('hidden');
  document.getElementById('cart-panel').classList.add('hidden');
}

async function checkoutCart() {
  if (cart.length === 0) return;
  const totalEl = document.getElementById('cart-total');
  try {
    totalEl.textContent = 'جاري التجهيز...';
    const { url } = await apiPost('/api/shop/checkout-cart', { items: cart });
    cart = [];
    saveCart();
    location.href = url;
  } catch (e) {
    renderCartPanel();
    $('shop-message') && ($('shop-message').innerHTML = `<div class="error-box">${e.message}</div>`);
  }
}

document.getElementById('btn-cart-float')?.addEventListener('click', openCartPanel);
document.getElementById('btn-cart-close')?.addEventListener('click', closeCartPanel);
document.getElementById('cart-overlay')?.addEventListener('click', closeCartPanel);
document.getElementById('btn-cart-checkout')?.addEventListener('click', checkoutCart);

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
  if (!currentUser) { window.shopAccess = null; updateHeaderCoinBadge(null); updateCartFloatBadge(); return null; }
  try {
    const wallet = await apiGet('/api/shop/wallet');
    window.shopAccess = wallet;
    applyAdsVisibility();
    updateHeaderCoinBadge(wallet);
    updateCartFloatBadge();
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
    renderUnlockList('shop-categories-list', catStatus, 'category', shopConfig.prices.category_single, c => c.name);
    renderUnlockList('shop-cases-list', caseStatus, 'case', shopConfig.prices.case_single, c => `قضية مستوى ${c.level} #${c.id}`);
    renderAllButtons(wallet);
    renderExtraButtons(wallet);
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
    const qty = cartQtyFor('coins', pkg.id);
    const card = document.createElement('div');
    card.className = 'shop-card';
    card.innerHTML = `
      <div class="shop-card-title">${pkg.coins} 🪙</div>
      <div class="shop-card-note">${pkg.label} — ${pkg.priceSAR} ريال</div>
      <div class="shop-qty-controls">
        <button type="button" data-act="minus">−</button>
        <span>${qty}</span>
        <button type="button" data-act="plus">+</button>
      </div>
      <button class="btn-add-to-cart shop-buy-btn">${qty > 0 ? '✅ بالسلة' : '🛒 أضف للسلة'}</button>
    `;
    card.querySelector('[data-act="minus"]').addEventListener('click', () => {
      addToCart('coins', pkg.id, Math.max(0, cartQtyFor('coins', pkg.id) - 1));
      renderPackages();
    });
    card.querySelector('[data-act="plus"]').addEventListener('click', () => {
      addToCart('coins', pkg.id, cartQtyFor('coins', pkg.id) + 1);
      renderPackages();
    });
    card.querySelector('.btn-add-to-cart').addEventListener('click', () => {
      addToCart('coins', pkg.id, Math.max(1, cartQtyFor('coins', pkg.id) || 1));
      renderPackages();
      openCartPanel();
    });
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
  const inCart = cart.some(l => l.kind === 'subscription');
  card.innerHTML = `
    <div class="shop-card-title">${sub.label}</div>
    <div class="shop-card-note">كل الفئات + كل القضايا + المافيا + بدون إعلانات + ${sub.monthlyGiftCoins} كوين هدية كل شهر</div>
    <button class="${already ? 'btn-primary' : 'btn-add-to-cart'} shop-buy-btn" ${already ? 'disabled' : ''}>
      ${already ? 'مفعّل حالياً ✅' : inCart ? '✅ بالسلة' : `🛒 أضف للسلة — ${sub.priceSAR} ريال/شهرياً`}
    </button>
  `;
  if (!already) {
    card.querySelector('button').addEventListener('click', () => {
      if (inCart) {
        cart = cart.filter(l => l.kind !== 'subscription');
        saveCart();
      } else {
        addToCart('subscription', null, 1);
        openCartPanel();
      }
      renderSubscriptionCard(wallet);
    });
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

async function startCheckout(kind, packageId) {
  $('shop-message').innerHTML = `<div class="center-note">يتم تجهيز صفحة الدفع...</div>`;
  try {
    const { url } = await apiPost('/api/shop/checkout', { kind, packageId });
    location.href = url; // تحويل المستخدم لصفحة الدفع المستضافة عند Moyasar
  } catch (e) {
    $('shop-message').innerHTML = `<div class="error-box">${e.message}</div>`;
  }
}

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
    // ينتظر تسجيل الدخول (init بـ app.js) قبل ما يفتح المتجر ويحدث الرصيد
    const tryOpen = () => {
      if (typeof currentUser !== 'undefined' && currentUser) {
        startShopMode();
      } else {
        setTimeout(tryOpen, 400);
      }
    };
    setTimeout(tryOpen, 300);
  }
})();
