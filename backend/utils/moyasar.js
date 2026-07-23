// ===================== تكامل بوابة الدفع Moyasar =====================
// يعتمد على "Invoices API" (صفحة دفع مستضافة عند Moyasar) بدل التعامل المباشر
// مع بيانات البطاقة — أبسط وأأمن لمشروع صغير (ما يحتاج شهادة PCI-DSS)
// التوثيق: https://docs.moyasar.com/api/invoices/01-create-invoice

const MOYASAR_API_BASE = 'https://api.moyasar.com/v1';

function getSecretKey() {
  const key = process.env.MOYASAR_SECRET_KEY;
  if (!key) throw new Error('MOYASAR_SECRET_KEY غير موجود بملف .env');
  return key;
}

// Basic Auth: اسم المستخدم = المفتاح السري، بدون كلمة مرور
function authHeader() {
  const token = Buffer.from(`${getSecretKey()}:`).toString('base64');
  return `Basic ${token}`;
}

/**
 * ينشئ فاتورة دفع مستضافة عند Moyasar ويرجع رابط صفحة الدفع
 * @param {Object} opts
 * @param {number} opts.amountSAR - المبلغ بالريال (يحوّل تلقائياً للهللة)
 * @param {string} opts.description - وصف مختصر يظهر للمستخدم بصفحة الدفع
 * @param {string} opts.callbackUrl - رابط الـ webhook (إشعار عند الدفع)
 * @param {string} opts.successUrl - يرجع له المستخدم بعد نجاح الدفع
 */
async function createInvoice({ amountSAR, description, callbackUrl, successUrl }) {
  const res = await fetch(`${MOYASAR_API_BASE}/invoices`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader()
    },
    body: JSON.stringify({
      amount: Math.round(amountSAR * 100), // هللة
      currency: 'SAR',
      description,
      callback_url: callbackUrl,
      success_url: successUrl
    })
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = (data && data.message) || 'فشل إنشاء فاتورة الدفع';
    throw new Error(msg);
  }
  return data; // { id, status, url, amount, ... }
}

// يجيب تفاصيل فاتورة معينة مباشرة من Moyasar (نستخدمها للتأكد الحقيقي إن الفاتورة انسددت
// قبل ما نضيف الكوينز، بدل ما نعتمد فقط على بيانات الـ webhook القادمة من المتصفح/الشبكة)
async function getInvoice(invoiceId) {
  const res = await fetch(`${MOYASAR_API_BASE}/invoices/${invoiceId}`, {
    headers: { Authorization: authHeader() }
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = (data && data.message) || 'تعذر جلب بيانات الفاتورة من Moyasar';
    throw new Error(msg);
  }
  return data; // { id, status, amount, ... }
}

module.exports = { createInvoice, getInvoice };
