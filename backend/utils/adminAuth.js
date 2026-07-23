const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

// ===== إنشاء أول حساب مشرف تلقائياً عند أول تشغيل =====
// يقرأ القيم من متغيرات البيئة (.env) بدل ما تكون مكتوبة بالكود مباشرة،
// عشان ما تنكشف كلمة المرور لو انرفع الكود لأي مكان (GitHub مثلاً).
async function bootstrapAdmin() {
  const count = (await db.prepare('SELECT COUNT(*) AS c FROM admins').get()).c;
  if (count > 0) return;

  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    console.warn('⚠️  ما فيه أي حساب مشرف، وما فيه ADMIN_USERNAME / ADMIN_PASSWORD في .env — لازم تضيفهم وتعيد التشغيل عشان تقدر تدخل لوحة التحكم.');
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(username, passwordHash);
  console.log(`✅ تم إنشاء أول حساب مشرف باسم المستخدم: ${username}`);
}

function signAdminToken(admin) {
  return jwt.sign(
    { id: admin.id, username: admin.username, role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '2d' }
  );
}

// يتأكد إن التوكن صادر لمشرف فعلاً (role: admin) قبل السماح بالدخول لأي مسار إداري
function requireAdmin(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'غير مصرح' });
  }
  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== 'admin') {
      return res.status(403).json({ error: 'هذا المسار خاص بالمشرفين فقط' });
    }
    req.admin = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'الجلسة منتهية، سجل دخولك مرة ثانية' });
  }
}

module.exports = { bootstrapAdmin, signAdminToken, requireAdmin };
