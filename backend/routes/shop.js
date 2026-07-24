const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { requireAuth } = require('../utils/authMiddleware');
const { ensureWallet, getSubscription, getUserAccess, nowSeconds } = require('../utils/entitlements');
const { COIN_PACKAGES, PRICES, SUBSCRIPTION, findPackage } = require('../data/shop-config');
const { createInvoice } = require('../utils/moyasar');

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
  res.json({ coinPackages: COIN_PACKAGES, prices: PRICES, subscription: SUBSCRIPTION });
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
    unlockedCategoryIds: [...access.categoryIds],
    unlockedCaseIds: [...access.caseIds]
  });
});

// ===== بدء عملية دفع حقيقية عبر Moyasar (منتج واحد) =====
// body: { kind: 'coins', packageId } أو { kind: 'subscription' }
router.post('/checkout', requireAuth, checkoutLimiter, async (req, res) => {
  const { kind } = req.body || {};

  try {
    let amountSAR, description, reference;

    if (kind === 'coins') {
      const pkg = findPackage(req.body.packageId);
      if (!pkg) return res.status(400).json({ error: 'باقة كوينز غير صحيحة' });
      amountSAR = pkg.priceSAR;
      description = `شحن ${pkg.coins} كوين - لمّة`;
      reference = pkg.id;
    } else if (kind === 'subscription') {
      amountSAR = SUBSCRIPTION.priceSAR;
      description = 'اشتراك لمّة بلس (شهري)';
      reference = SUBSCRIPTION.id;
    } else {
      return res.status(400).json({ error: 'نوع عملية غير صحيح' });
    }

    const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const invoice = await createInvoice({
      amountSAR,
      description,
      callbackUrl: `${baseUrl}/api/shop/webhook`,
      successUrl: `${baseUrl}/?shop=success`
    });

    db.prepare(`
      INSERT INTO payments (user_id, moyasar_invoice_id, kind, reference, amount_halalas, status)
      VALUES (?, ?, ?, ?, ?, 'initiated')
    `).run(req.user.id, invoice.id, kind, reference, Math.round(amountSAR * 100));

    res.json({ url: invoice.url });
  } catch (err) {
    console.error('خطأ إنشاء فاتورة Moyasar:', err.message);
    res.status(500).json({ error: 'تعذر بدء عملية الدفع، حاول لاحقاً' });
  }
});

// ===== بدء عملية دفع حقيقية عبر Moyasar (سلة فيها أكثر من عنصر) =====
// body: { items: [{ kind: 'coins', packageId, qty }, { kind: 'subscription' }] }
// كل عناصر السلة تُدفع بفاتورة Moyasar وحدة (مبلغ إجمالي)، وتُصرف كلها دفعة وحدة عند تأكيد الدفع بالـ webhook
router.post('/checkout-cart', requireAuth, checkoutLimiter, async (req, res) => {
  const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
  if (items.length === 0) return res.status(400).json({ error: 'السلة فاضية' });
  if (items.length > 20) return res.status(400).json({ error: 'عدد عناصر السلة كبير جداً' });

  try {
    let amountSAR = 0;
    const normalized = [];
    const descriptionParts = [];
    let sawSubscription = false;

    for (const raw of items) {
      const qty = Math.min(Math.max(parseInt(raw.qty, 10) || 1, 1), 20);

      if (raw.kind === 'coins') {
        const pkg = findPackage(raw.packageId);
        if (!pkg) return res.status(400).json({ error: 'باقة كوينز غير صحيحة بالسلة' });
        amountSAR += pkg.priceSAR * qty;
        normalized.push({ kind: 'coins', packageId: pkg.id, qty });
        descriptionParts.push(`${pkg.coins} كوين × ${qty}`);
      } else if (raw.kind === 'subscription') {
        if (sawSubscription) continue; // الاشتراك مرة وحدة بالسلة حتى لو انضاف مرتين
        sawSubscription = true;
        amountSAR += SUBSCRIPTION.priceSAR;
        normalized.push({ kind: 'subscription', qty: 1 });
        descriptionParts.push('اشتراك لمّة بلس');
      } else {
        return res.status(400).json({ error: 'عنصر غير صحيح بالسلة' });
      }
    }

    if (normalized.length === 0) return res.status(400).json({ error: 'السلة فاضية' });

    const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const invoice = await createInvoice({
      amountSAR,
      description: `طلب لمّة: ${descriptionParts.join(' + ')}`.slice(0, 250),
      callbackUrl: `${baseUrl}/api/shop/webhook`,
      successUrl: `${baseUrl}/?shop=success`
    });

    db.prepare(`
      INSERT INTO payments (user_id, moyasar_invoice_id, kind, reference, amount_halalas, status)
      VALUES (?, ?, 'cart', ?, ?, 'initiated')
    `).run(req.user.id, invoice.id, JSON.stringify(normalized), Math.round(amountSAR * 100));

    res.json({ url: invoice.url });
  } catch (err) {
    console.error('خطأ إنشاء فاتورة سلة Moyasar:', err.message);
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

    const row = db.prepare('SELECT * FROM payments WHERE moyasar_invoice_id = ?').get(payment.invoice_id);
    if (!row) return console.warn('استلمنا webhook لفاتورة مو موجودة عندنا:', payment.invoice_id);
    if (row.status === 'paid') return; // معالج مسبقاً (idempotency)

    db.prepare(`UPDATE payments SET status = 'paid', updated_at = strftime('%s','now') WHERE id = ?`).run(row.id);

    if (row.kind === 'coins') {
      const pkg = findPackage(row.reference);
      if (pkg) creditCoins(row.user_id, pkg.coins, 'purchase', `invoice:${row.moyasar_invoice_id}`);
    } else if (row.kind === 'subscription') {
      activateSubscription(row.user_id);
    } else if (row.kind === 'cart') {
      let items = [];
      try { items = JSON.parse(row.reference); } catch (e) { items = []; }
      for (const item of items) {
        if (item.kind === 'coins') {
          const pkg = findPackage(item.packageId);
          if (pkg) creditCoins(row.user_id, pkg.coins * (item.qty || 1), 'purchase', `invoice:${row.moyasar_invoice_id}`);
        } else if (item.kind === 'subscription') {
          activateSubscription(row.user_id);
        }
      }
    }
  } catch (err) {
    console.error('خطأ معالجة webhook Moyasar:', err);
  }
});

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
      VALUES (?, 'active', ?, NULL)
    `).run(userId, periodEnd);
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
