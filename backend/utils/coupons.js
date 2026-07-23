// ===================== كوبونات الخصم =====================
// دوال مشتركة للتحقق من كوبون وحساب الخصم وتسجيل استخدامه
// تُستخدم بمسار الشراء (routes/shop.js) ولوحة تحكم المشرف (routes/admin.js)

const db = require('../db');

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

// يتحقق من صلاحية كوبون لمستخدم معيّن، ويرجع { coupon } لو صحيح أو { error } لو لأ
async function validateCoupon(code, userId) {
  const normalized = normalizeCode(code);
  if (!normalized) return { error: 'أدخل كود الكوبون' };

  const coupon = await db.prepare('SELECT * FROM coupons WHERE code = ?').get(normalized);
  if (!coupon) return { error: 'كوبون غير موجود' };
  if (!coupon.active) return { error: 'هذا الكوبون غير مفعّل حالياً' };
  if (coupon.expires_at && coupon.expires_at < nowSeconds()) {
    return { error: 'انتهت صلاحية هذا الكوبون' };
  }
  if (coupon.max_uses !== null && coupon.max_uses !== undefined && coupon.used_count >= coupon.max_uses) {
    return { error: 'وصل هذا الكوبون للحد الأقصى من الاستخدام' };
  }
  if (userId) {
    const already = await db.prepare('SELECT id FROM coupon_redemptions WHERE coupon_id = ? AND user_id = ?')
      .get(coupon.id, userId);
    if (already) return { error: 'سبق واستخدمت هذا الكوبون' };
  }
  return { coupon };
}

// يحسب مقدار الخصم بالريال (بدون ما يخلي المبلغ سالب)
function computeDiscount(amountSAR, coupon) {
  let discount = coupon.discount_type === 'fixed'
    ? coupon.discount_value
    : amountSAR * (coupon.discount_value / 100);
  discount = Math.max(0, Math.min(discount, amountSAR));
  return Math.round(discount * 100) / 100;
}

// يسجل استخدام الكوبون (يُستدعى فقط بعد نجاح الدفع الفعلي، مو وقت إنشاء الفاتورة)
async function redeemCoupon(couponId, userId) {
  await db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(couponId);
  await db.prepare('INSERT OR IGNORE INTO coupon_redemptions (coupon_id, user_id) VALUES (?, ?)').run(couponId, userId);
}

module.exports = { validateCoupon, computeDiscount, redeemCoupon, normalizeCode };
