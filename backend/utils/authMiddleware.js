const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'غير مصرح' });
  }
  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'الجلسة منتهية، سجل دخولك مرة ثانية' });
  }
}

// نسخة للتحقق من التوكن يدوياً (تستخدم في Socket.io)
function verifySocketToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

// مصادقة اختيارية: لو فيه توكن صحيح يعبّي req.user، ولو ما فيه (أو غير صحيح) يكمل عادي بدون خطأ
// تستخدم بمسارات المحتوى المجاني/المدفوع اللي لازم تشتغل لغير المسجلين وتعرض محتوى إضافي للمسجلين
function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const token = header.split(' ')[1];
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
      req.user = null;
    }
  } else {
    req.user = null;
  }
  next();
}

module.exports = { requireAuth, verifySocketToken, optionalAuth };
