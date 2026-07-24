// ===================== إعدادات متجر "لمّة كوين" =====================
// عدّل أي رقم هنا وينعكس تلقائياً بكل مكان (السيرفر + واجهة المتجر)
// المبالغ بالريال، وكوينز الشراء عبر Moyasar تحسب بالهللة (1 ريال = 100 هللة)

// ----- باقات شراء الكوينز -----
const COIN_PACKAGES = [
  { id: 'starter', priceSAR: 3, coins: 30, label: 'باقة تجريبية' },
  { id: 'plus', priceSAR: 10, coins: 110, label: 'خصم 10%' },
  { id: 'best', priceSAR: 25, coins: 300, label: 'أفضل قيمة — خصم 20%' }
];

// ----- أسعار فتح المحتوى بالكوينز -----
const PRICES = {
  category_single: 15,   // فئة إضافية واحدة من لعبة لمّة
  category_all: 80,      // كل فئات لمّة دفعة وحدة
  case_single: 20,       // قضية تحري واحدة
  case_all: 100,         // كل قضايا التحري دفعة وحدة
  mafia: 120,             // فتح لعبة المافيا (دائم)
  remove_ads: 150         // إزالة الإعلانات (دائم)
};

// ----- اشتراك "لمّة بلس" الشهري -----
const SUBSCRIPTION = {
  id: 'lamma_plus',
  priceSAR: 25,
  monthlyGiftCoins: 50,
  durationDays: 30,
  label: 'لمّة بلس'
};

function findPackage(packageId) {
  return COIN_PACKAGES.find(p => p.id === packageId) || null;
}

// ----- كوبونات الخصم -----
// عدّل/أضف/احذف أكواد من هنا، الكود ما يفرق فيه حروف كبيرة/صغيرة
const COUPONS = [
  { code: 'WELCOME10', type: 'percent', value: 10, label: 'خصم 10%' },
  { code: 'LAMMA5', type: 'fixed', value: 5, label: 'خصم 5 ريال' }
];

function findCoupon(code) {
  if (!code) return null;
  const clean = String(code).trim().toUpperCase();
  if (!clean) return null;
  return COUPONS.find(c => c.code.toUpperCase() === clean) || null;
}

// يحسب مبلغ الخصم بالريال على مبلغ معين، بدون ما ينزل المجموع تحت الصفر
function calcDiscount(coupon, subtotalSAR) {
  if (!coupon) return 0;
  const discount = coupon.type === 'percent' ? (subtotalSAR * coupon.value / 100) : coupon.value;
  return Math.min(Math.max(discount, 0), subtotalSAR);
}

module.exports = { COIN_PACKAGES, PRICES, SUBSCRIPTION, findPackage, COUPONS, findCoupon, calcDiscount };
