const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { requireAuth } = require('../utils/authMiddleware');
const { ensureWallet, getSubscription, getUserAccess, nowSeconds } = require('../utils/entitlements');
const { COIN_PACKAGES, PRICES, SUBSCRIPTION, findPackage } = require('../data/shop-config');
const { createInvoice } = require('../utils/moyasar');
const { validateCoupon, computeDiscount, redeemCoupon } = require('../utils/coupons');

const router = express.Router();

const checkoutLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: { error: 'محاولات دفع كثيرة، حاول بعد شوي' },
  standardHeaders: true,
  legacyHeaders: false
});

const couponLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: { error: 'محاولات كثيرة، حاول بعد شوي' },
  standardHeaders: true,
  legacyHeaders: false
});

// ===== إعدادات المتجر (عامة، بدون تسجيل دخول) =====
router.get('/config', (req, res) => {
  res.json({ coinPackages: COIN_PACKAGES, prices: PRICES, subscription: SUBSCRIPTION });
});

// ===== محفظة المستخدم =====
router.get('/wallet', requireAuth, async (req, res) => {
  const wallet = await ensureWallet(req.user.id);
  const sub = await getSubscription(req.user.id);
  const access = await getUserAccess(req.user.id);

  res.json({
    coins: wallet.coins,
    subscriptionActive: access.subscriptionActive,
    subscriptionPeriodEnd: sub ? sub.current_period_end : null,
    hasAllCategories: access.hasAllCategories,
    hasAllCases: access.hasAllCases,
    hasMafia: access.hasMafia,
    hasRemoveAds: access.hasRemoveAds,
    unlockedCategoryIds: [...access.categoryIds],
    unlockedCaseIds: [...access.caseIds]
  });
});

// ===== بناء عناصر السلة والتحقق منها =====
// items: [{ kind: 'coins', packageId }] أو [{ kind: 'subscription' }]
function buildCartLines(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { error: 'السلة فاضية' };
  }
  if (items.length > 10) {
    return { error: 'عدد عناصر السلة كبير جداً' };
  }

  const lines = [];
  let subtotal = 0;

  for (const raw of items) {
    const kind = raw && raw.kind;
    if (kind === 'coins') {
      const pkg = findPackage(raw.packageId);
      if (!pkg) return { error: 'باقة كوينز غير صحيحة' };
      lines.push({ kind: 'coins', reference: pkg.id, amountSAR: pkg.priceSAR, label: `شحن ${pkg.coins} كوين` });
      subtotal += pkg.priceSAR;
    } else if (kind === 'subscription') {
      lines.push({ kind: 'subscription', reference: SUBSCRIPTION.id, amountSAR: SUBSCRIPTION.priceSAR, label: 'اشتراك لمّة بلس (شهري)' });
      subtotal += SUBSCRIPTION.priceSAR;
    } else {
      return { error: 'نوع عنصر غير صحيح بالسلة' };
    }
  }

  return { lines, subtotal: Math.round(subtotal * 100) / 100 };
}

// ===== معاينة السلة + الكوبون قبل الدفع (يحسب السيرفر الإجمالي، ما يوثق بأرقام الواجهة) =====
// body: { items: [...], couponCode? }
router.post('/cart/preview', requireAuth, couponLimiter, async (req, res) => {
  const { items, couponCode } = req.body || {};

  const built = buildCartLines(items);
  if (built.error) return res.status(400).json({ error: built.error });

  let discountSAR = 0;
  let couponMessage = null;

  if (couponCode) {
    const result = await validateCoupon(couponCode, req.user.id);
    if (result.error) return res.status(400).json({ error: result.error });
    discountSAR = computeDiscount(built.subtotal, result.coupon);
    couponMessage = `تم تطبيق كوبون ${result.coupon.code}`;
  }

  const total = Math.max(Math.round((built.subtotal - discountSAR) * 100) / 100, 0);
  res.json({ subtotal: built.subtotal, discount: discountSAR, total, couponMessage });
});

// ===== بدء عملية دفع حقيقية عبر Moyasar (سلة تدعم أكثر من عنصر + كوبون اختياري) =====
// body: { items: [{ kind: 'coins', packageId }] أو [{ kind: 'subscription' }], couponCode? }
router.post('/checkout', requireAuth, checkoutLimiter, async (req, res) => {
  const { items, couponCode } = req.body || {};

  const built = buildCartLines(items);
  if (built.error) return res.status(400).json({ error: built.error });

  try {
    let coupon = null;
    let discountSAR = 0;

    if (couponCode) {
      const result = await validateCoupon(couponCode, req.user.id);
      if (result.error) return res.status(400).json({ error: result.error });
      coupon = result.coupon;
      discountSAR = computeDiscount(built.subtotal, coupon);
    }

    // الحد الأدنى المقبول من Moyasar ريال واحد، حتى لو الخصم غطى كل المبلغ
    const finalAmountSAR = Math.max(Math.round((built.subtotal - discountSAR) * 100) / 100, 1);
    const description = built.lines.map(l => l.label).join(' + ');

    const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const invoice = await createInvoice({
      amountSAR: finalAmountSAR,
      description,
      callbackUrl: `${baseUrl}/api/shop/webhook`,
      successUrl: `${baseUrl}/?shop=success`
    });

    await db.prepare(`
      INSERT INTO payments (user_id, moyasar_invoice_id, kind, reference, amount_halalas, status, cart_items, coupon_code, discount_halalas)
      VALUES (?, ?, 'cart', 'cart', ?, 'initiated', ?, ?, ?)
    `).run(
      req.user.id,
      invoice.id,
      Math.round(finalAmountSAR * 100),
      JSON.stringify(built.lines),
      coupon ? coupon.code : null,
      Math.round(discountSAR * 100)
    );

    res.json({ url: invoice.url });
  } catch (err) {
    console.error('خطأ إنشاء فاتورة Moyasar:', err.message);
    res.status(500).json({ error: 'تعذر بدء عملية الدفع، حاول لاحقاً' });
  }
});

// ===== إشعار Moyasar عند اكتمال الدفع (Webhook) =====
// ملاحظة: هذا المسار عام (بدون requireAuth) لأن Moyasar هي اللي تستدعيه، وليس المستخدم
router.post('/webhook', async (req, res) => {
  const payload = req.body || {};

  // تحقق من التوكن السري عشان نتأكد إن الطلب فعلاً من Moyasar
  if (!process.env.MOYASAR_WEBHOOK_SECRET || payload.secret_token !== process.env.MOYASAR_WEBHOOK_SECRET) {
    console.warn('🔔 webhook مرفوض: توكن سري غير متطابق. المستلم:', payload.secret_token, '| المتوقع مضبوط:', !!process.env.MOYASAR_WEBHOOK_SECRET);
    return res.status(401).json({ error: 'توكن غير صحيح' });
  }

  console.log('🔔 webhook مقبول، نوع الحدث:', payload.type);

  // نرد 2xx بسرعة دائماً (موصى به من توثيق Moyasar) حتى لو الحدث مو اللي نهتم فيه
  res.status(200).json({ received: true });

  try {
    if (payload.type !== 'payment_paid') return;
    const payment = payload.data;
    if (!payment || !payment.invoice_id) return;

    const row = await db.prepare('SELECT * FROM payments WHERE moyasar_invoice_id = ?').get(payment.invoice_id);
    if (!row) return console.warn('🔔 استلمنا webhook لفاتورة مو موجودة عندنا:', payment.invoice_id);
    if (row.status === 'paid') return console.log('🔔 هذي الفاتورة اتعالجت من قبل (idempotency):', payment.invoice_id);

    await db.prepare(`UPDATE payments SET status = 'paid', updated_at = strftime('%s','now') WHERE id = ?`).run(row.id);

    // تسجيل استخدام الكوبون بعد نجاح الدفع الفعلي فقط (مو وقت إنشاء الفاتورة)
    if (row.coupon_code) {
      const c = await db.prepare('SELECT * FROM coupons WHERE code = ?').get(row.coupon_code);
      if (c) await redeemCoupon(c.id, row.user_id);
    }

    let cartItems = null;
    try { cartItems = row.cart_items ? JSON.parse(row.cart_items) : null; } catch (e) { cartItems = null; }

    if (cartItems) {
      for (const item of cartItems) {
        if (item.kind === 'coins') {
          const pkg = findPackage(item.reference);
          if (pkg) await creditCoins(row.user_id, pkg.coins, 'purchase', `invoice:${row.moyasar_invoice_id}`);
        } else if (item.kind === 'subscription') {
          await activateSubscription(row.user_id);
        }
      }
    } else if (row.kind === 'coins') {
      // توافق مع فواتير قديمة أُنشئت قبل تحديث السلة (كانت تخزن kind/reference مباشرة)
      const pkg = findPackage(row.reference);
      if (pkg) await creditCoins(row.user_id, pkg.coins, 'purchase', `invoice:${row.moyasar_invoice_id}`);
    } else if (row.kind === 'subscription') {
      await activateSubscription(row.user_id);
    }

    console.log('✅ تمت معالجة الدفعة وإضافة المحتوى للمستخدم:', row.user_id, 'فاتورة:', payment.invoice_id);
  } catch (err) {
    console.error('خطأ معالجة webhook Moyasar:', err);
  }
});

async function creditCoins(userId, amount, reason, reference) {
  await ensureWallet(userId);
  await db.prepare('UPDATE wallets SET coins = coins + ?, updated_at = strftime(\'%s\',\'now\') WHERE user_id = ?').run(amount, userId);
  await db.prepare('INSERT INTO coin_transactions (user_id, amount, reason, reference) VALUES (?, ?, ?, ?)')
    .run(userId, amount, reason, reference || null);
}

async function activateSubscription(userId) {
  const periodEnd = nowSeconds() + SUBSCRIPTION.durationDays * 24 * 60 * 60;
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

  const existing = await db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId);
  if (existing) {
    await db.prepare(`
      UPDATE subscriptions
      SET status = 'active', current_period_end = ?, updated_at = strftime('%s','now')
      WHERE user_id = ?
    `).run(periodEnd, userId);
  } else {
    await db.prepare(`
      INSERT INTO subscriptions (user_id, status, current_period_end, last_gift_period)
      VALUES (?, 'active', ?, ?)
    `).run(userId, periodEnd, currentMonth);
  }

  // هدية الكوينز الشهرية — تُمنح مرة وحدة بالشهر فقط
  const sub = await db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId);
  if (sub.last_gift_period !== currentMonth) {
    await creditCoins(userId, SUBSCRIPTION.monthlyGiftCoins, 'subscription_gift', currentMonth);
    await db.prepare('UPDATE subscriptions SET last_gift_period = ? WHERE user_id = ?').run(currentMonth, userId);
  }
}

// ===== فتح محتوى مباشرة بالكوينز (بدون بوابة دفع) =====
// body: { itemType: 'category'|'case'|'all_categories'|'all_cases'|'mafia'|'remove_ads', itemId? }
router.post('/unlock', requireAuth, async (req, res) => {
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
    const cat = await db.prepare('SELECT id FROM categories WHERE id = ?').get(itemId);
    if (!cat) return res.status(404).json({ error: 'الفئة غير موجودة' });
  } else if (itemType === 'case') {
    const c = await db.prepare('SELECT id FROM detective_cases WHERE id = ?').get(itemId);
    if (!c) return res.status(404).json({ error: 'القضية غير موجودة' });
  }

  const finalItemId = needsId ? itemId : null;

  // امنع الشراء المكرر
  const already = await db.prepare('SELECT id FROM unlocks WHERE user_id = ? AND item_type = ? AND item_id IS ?')
    .get(userId, itemType, finalItemId);
  if (already) return res.status(409).json({ error: 'هذا العنصر مفتوح مسبقاً' });

  const wallet = await ensureWallet(userId);
  if (wallet.coins < price) {
    return res.status(402).json({ error: 'رصيد الكوينز غير كافي', needed: price, have: wallet.coins });
  }

  await db.prepare('UPDATE wallets SET coins = coins - ?, updated_at = strftime(\'%s\',\'now\') WHERE user_id = ?').run(price, userId);
  await db.prepare('INSERT INTO coin_transactions (user_id, amount, reason, reference) VALUES (?, ?, ?, ?)')
    .run(userId, -price, 'spend', `${itemType}:${finalItemId ?? 'all'}`);
  await db.prepare('INSERT INTO unlocks (user_id, item_type, item_id) VALUES (?, ?, ?)').run(userId, itemType, finalItemId);

  const updatedWallet = await db.prepare('SELECT coins FROM wallets WHERE user_id = ?').get(userId);
  res.json({ ok: true, remainingCoins: updatedWallet.coins });
});

module.exports = router;
