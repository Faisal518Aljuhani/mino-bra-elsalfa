const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { requireAuth } = require('../utils/authMiddleware');
const { ensureWallet, getSubscription, getUserAccess, nowSeconds } = require('../utils/entitlements');
const { COIN_PACKAGES, PRICES, SUBSCRIPTION, ONLINE_PLAY, findPackage, findCoupon, calcDiscount } = require('../data/shop-config');
const { createInvoice, getInvoice } = require('../utils/moyasar');

const router = express.Router();

const checkoutLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: { error: 'محاولات دفع كثيرة، حاول بعد شوي' },
  standardHeaders: true,
  legacyHeaders: false
});

// ===== إعدادات المتجر (عامة، بدون تسجيل دخول) =====
router.get('/config', (req, res) => {
  res.json({ coinPackages: COIN_PACKAGES, prices: PRICES, subscription: SUBSCRIPTION, onlinePlay: ONLINE_PLAY });
});

// ===== محفظة المستخدم =====
router.get('/wallet', requireAuth, (req, res) => {
  const wallet = ensureWallet(req.user.id);
  const sub = getSubscription(req.user.id);
  const access = getUserAccess(req.user.id);

  res.json({
    coins: wallet.coins,
    subscriptionActive: access.subscriptionActive,
    subscriptionPeriodEnd: sub ? sub.current_period_end : null,
    hasAllCategories: access.hasAllCategories,
    hasAllCases: access.hasAllCases,
    hasMafia: access.hasMafia,
    hasRemoveAds: access.hasRemoveAds,
    hasOnlinePlay: access.hasOnlinePlay,
    unlockedCategoryIds: [...access.categoryIds],
    unlockedCaseIds: [...access.caseIds]
  });
});

// ===== يتحقق من كود خصم قبل الدفع (يستخدمه الفرونت إند وهو يعرض السلة) =====
router.post('/validate-coupon', requireAuth, (req, res) => {
  const { code } = req.body || {};
  const coupon = findCoupon(code);
  if (!coupon) return res.status(404).json({ error: 'كود الخصم غير صحيح أو منتهي' });
  res.json({ code: coupon.code, type: coupon.type, value: coupon.value, label: coupon.label });
});

// ===== بدء عملية دفع حقيقية عبر Moyasar لسلة كاملة (باقة أو أكثر + اشتراك اختياري) =====
// body: { items: [{ kind: 'coins', packageId } | { kind: 'subscription' }], couponCode? }
router.post('/checkout', requireAuth, checkoutLimiter, async (req, res) => {
  const { items, couponCode } = req.body || {};

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'السلة فارغة، أضف عنصر واحد على الأقل' });
  }
  if (items.length > 10) {
    return res.status(400).json({ error: 'عدد العناصر بالسلة كبير زيادة' });
  }

  try {
    let subtotalSAR = 0;
    const normalizedItems = [];
    const descriptions = [];

    for (const raw of items) {
      const kind = raw && raw.kind;
      if (kind === 'coins') {
        const pkg = findPackage(raw.packageId);
        if (!pkg) return res.status(400).json({ error: 'باقة كوينز غير صحيحة' });
        subtotalSAR += pkg.priceSAR;
        normalizedItems.push({ kind: 'coins', packageId: pkg.id });
        descriptions.push(`${pkg.coins} كوين`);
      } else if (kind === 'subscription') {
        subtotalSAR += SUBSCRIPTION.priceSAR;
        normalizedItems.push({ kind: 'subscription' });
        descriptions.push('اشتراك لمّة بلس');
      } else if (kind === 'online_play') {
        subtotalSAR += ONLINE_PLAY.priceSAR;
        normalizedItems.push({ kind: 'online_play' });
        descriptions.push('لعب أونلاين');
      } else {
        return res.status(400).json({ error: 'عنصر غير صحيح بالسلة' });
      }
    }

    let discountSAR = 0;
    let appliedCouponCode = null;
    if (couponCode) {
      const coupon = findCoupon(couponCode);
      if (!coupon) return res.status(400).json({ error: 'كود الخصم غير صحيح' });
      discountSAR = calcDiscount(coupon, subtotalSAR);
      appliedCouponCode = coupon.code;
    }

    // مويسر يحتاج مبلغ أكبر من صفر
    const totalSAR = Math.max(subtotalSAR - discountSAR, 0.5);
    const description = `${descriptions.join(' + ')} - لمّة`;

    const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const invoice = await createInvoice({
      amountSAR: totalSAR,
      description,
      callbackUrl: `${baseUrl}/api/shop/webhook`,
      successUrl: `${baseUrl}/?shop=success`
    });

    db.prepare(`
      INSERT INTO payments (user_id, moyasar_invoice_id, kind, reference, amount_halalas, cart_items, coupon_code, discount_halalas, status)
      VALUES (?, ?, 'cart', NULL, ?, ?, ?, ?, 'initiated')
    `).run(
      req.user.id,
      invoice.id,
      Math.round(totalSAR * 100),
      JSON.stringify(normalizedItems),
      appliedCouponCode,
      Math.round(discountSAR * 100)
    );

    res.json({ url: invoice.url, invoiceId: invoice.id });
  } catch (err) {
    console.error('خطأ إنشاء فاتورة Moyasar:', err.message);
    res.status(500).json({ error: 'تعذر بدء عملية الدفع، حاول لاحقاً' });
  }
});

// ===== إشعار Moyasar عند اكتمال الدفع (Webhook) =====
// ملاحظة: هذا المسار عام (بدون requireAuth) لأن Moyasar هي اللي تستدعيه، وليس المستخدم
router.post('/webhook', (req, res) => {
  const payload = req.body || {};

  // تحقق من التوكن السري عشان نتأكد إن الطلب فعلاً من Moyasar
  if (!process.env.MOYASAR_WEBHOOK_SECRET || payload.secret_token !== process.env.MOYASAR_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'توكن غير صحيح' });
  }

  // نرد 2xx بسرعة دائماً (موصى به من توثيق Moyasar) حتى لو الحدث مو اللي نهتم فيه
  res.status(200).json({ received: true });

  try {
    if (payload.type !== 'payment_paid') return;
    const payment = payload.data;
    if (!payment || !payment.invoice_id) return;
    fulfillInvoiceIfPaid(payment.invoice_id);
  } catch (err) {
    console.error('خطأ معالجة webhook Moyasar:', err);
  }
});

// ===== تأكيد الدفع يدوياً لما المستخدم يرجع من صفحة الدفع =====
// خطة بديلة لو الـ webhook ما وصل (شائع أثناء التشغيل المحلي، لأن Moyasar ما تقدر
// توصل سيرفرك المحلي أصلاً — بعكس هذا الطلب اللي صادر من سيرفرنا لهم، فيشتغل دائماً)
router.post('/verify', requireAuth, checkoutLimiter, async (req, res) => {
  const { invoiceId } = req.body || {};
  if (!invoiceId) return res.status(400).json({ error: 'رقم الفاتورة مطلوب' });

  const row = db.prepare('SELECT * FROM payments WHERE moyasar_invoice_id = ?').get(invoiceId);
  if (!row || row.user_id !== req.user.id) {
    return res.status(404).json({ error: 'الفاتورة غير موجودة' });
  }

  if (row.status === 'paid') {
    return res.json({ status: 'paid' });
  }

  try {
    const credited = await fulfillInvoiceIfPaid(invoiceId);
    res.json({ status: credited ? 'paid' : 'pending' });
  } catch (err) {
    console.error('خطأ التحقق اليدوي من فاتورة Moyasar:', err.message);
    res.status(500).json({ error: 'تعذر التحقق من حالة الدفع، حاول بعد شوي' });
  }
});

// يتحقق من حالة فاتورة معينة (من قاعدة بياناتنا أو مباشرة من Moyasar) ويمنح المحتوى لو انصرفت فعلاً
// idempotent: آمن نستدعيه أكثر من مرة لنفس الفاتورة (من الـ webhook و/أو من route التحقق اليدوي)
async function fulfillInvoiceIfPaid(invoiceId) {
  const row = db.prepare('SELECT * FROM payments WHERE moyasar_invoice_id = ?').get(invoiceId);
  if (!row) { console.warn('فاتورة مو موجودة عندنا:', invoiceId); return false; }
  if (row.status === 'paid') return true; // معالج مسبقاً (idempotency)

  const invoice = await getInvoice(invoiceId);
  if (invoice.status !== 'paid') return false;

  db.prepare(`UPDATE payments SET status = 'paid', updated_at = strftime('%s','now') WHERE id = ?`).run(row.id);

  if (row.kind === 'cart') {
    let items = [];
    try { items = JSON.parse(row.cart_items || '[]'); } catch (e) { items = []; }
    for (const item of items) {
      if (item.kind === 'coins') {
        const pkg = findPackage(item.packageId);
        if (pkg) creditCoins(row.user_id, pkg.coins, 'purchase', `invoice:${row.moyasar_invoice_id}`);
      } else if (item.kind === 'subscription') {
        activateSubscription(row.user_id);
      } else if (item.kind === 'online_play') {
        const already = db.prepare("SELECT id FROM unlocks WHERE user_id = ? AND item_type = 'online_play' AND item_id IS NULL").get(row.user_id);
        if (!already) {
          db.prepare("INSERT INTO unlocks (user_id, item_type, item_id) VALUES (?, 'online_play', NULL)").run(row.user_id);
        }
      }
    }
  } else if (row.kind === 'coins') {
    const pkg = findPackage(row.reference);
    if (pkg) creditCoins(row.user_id, pkg.coins, 'purchase', `invoice:${row.moyasar_invoice_id}`);
  } else if (row.kind === 'subscription') {
    activateSubscription(row.user_id);
  }
  return true;
}

function creditCoins(userId, amount, reason, reference) {
  ensureWallet(userId);
  db.prepare('UPDATE wallets SET coins = coins + ?, updated_at = strftime(\'%s\',\'now\') WHERE user_id = ?').run(amount, userId);
  db.prepare('INSERT INTO coin_transactions (user_id, amount, reason, reference) VALUES (?, ?, ?, ?)')
    .run(userId, amount, reason, reference || null);
}

function activateSubscription(userId) {
  const periodEnd = nowSeconds() + SUBSCRIPTION.durationDays * 24 * 60 * 60;
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

  const existing = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId);
  if (existing) {
    db.prepare(`
      UPDATE subscriptions
      SET status = 'active', current_period_end = ?, updated_at = strftime('%s','now')
      WHERE user_id = ?
    `).run(periodEnd, userId);
  } else {
    db.prepare(`
      INSERT INTO subscriptions (user_id, status, current_period_end, last_gift_period)
      VALUES (?, 'active', ?, ?)
    `).run(userId, periodEnd, currentMonth);
  }

  // هدية الكوينز الشهرية — تُمنح مرة وحدة بالشهر فقط
  const sub = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId);
  if (sub.last_gift_period !== currentMonth) {
    creditCoins(userId, SUBSCRIPTION.monthlyGiftCoins, 'subscription_gift', currentMonth);
    db.prepare('UPDATE subscriptions SET last_gift_period = ? WHERE user_id = ?').run(currentMonth, userId);
  }
}

// ===== فتح محتوى مباشرة بالكوينز (بدون بوابة دفع) =====
// body: { itemType: 'category'|'case'|'all_categories'|'all_cases'|'mafia'|'remove_ads', itemId? }
router.post('/unlock', requireAuth, (req, res) => {
  const { itemType, itemId } = req.body || {};
  const userId = req.user.id;

  const priceMap = {
    category: PRICES.category_single,
    case: PRICES.case_single,
    all_categories: PRICES.category_all,
    all_cases: PRICES.case_all,
    mafia: PRICES.mafia,
    remove_ads: PRICES.remove_ads
  };

  const price = priceMap[itemType];
  if (price === undefined) return res.status(400).json({ error: 'نوع عنصر غير صحيح' });

  const needsId = itemType === 'category' || itemType === 'case';
  if (needsId && !Number.isInteger(itemId)) {
    return res.status(400).json({ error: 'رقم العنصر مطلوب' });
  }

  // تحقق العنصر موجود فعلياً (لفئة/قضية)
  if (itemType === 'category') {
    const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(itemId);
    if (!cat) return res.status(404).json({ error: 'الفئة غير موجودة' });
  } else if (itemType === 'case') {
    const c = db.prepare('SELECT id FROM detective_cases WHERE id = ?').get(itemId);
    if (!c) return res.status(404).json({ error: 'القضية غير موجودة' });
  }

  const finalItemId = needsId ? itemId : null;

  // امنع الشراء المكرر
  const already = db.prepare('SELECT id FROM unlocks WHERE user_id = ? AND item_type = ? AND item_id IS ?')
    .get(userId, itemType, finalItemId);
  if (already) return res.status(409).json({ error: 'هذا العنصر مفتوح مسبقاً' });

  const wallet = ensureWallet(userId);
  if (wallet.coins < price) {
    return res.status(402).json({ error: 'رصيد الكوينز غير كافي', needed: price, have: wallet.coins });
  }

  db.prepare('UPDATE wallets SET coins = coins - ?, updated_at = strftime(\'%s\',\'now\') WHERE user_id = ?').run(price, userId);
  db.prepare('INSERT INTO coin_transactions (user_id, amount, reason, reference) VALUES (?, ?, ?, ?)')
    .run(userId, -price, 'spend', `${itemType}:${finalItemId ?? 'all'}`);
  db.prepare('INSERT INTO unlocks (user_id, item_type, item_id) VALUES (?, ?, ?)').run(userId, itemType, finalItemId);

  const updatedWallet = db.prepare('SELECT coins FROM wallets WHERE user_id = ?').get(userId);
  res.json({ ok: true, remainingCoins: updatedWallet.coins });
});

module.exports = router;
