const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { sendVerificationEmail, sendResetEmail } = require('../utils/email');

const router = express.Router();

// تحديد معدل المحاولات لمنع هجمات القوة الغاشمة (brute force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 10,
  message: { error: 'محاولات كثيرة، حاول بعد شوي' },
  standardHeaders: true,
  legacyHeaders: false
});

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_TIME_MS = 15 * 60 * 1000;

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// ===== تسجيل حساب جديد =====
router.post('/register',
  authLimiter,
  body('username').trim().isLength({ min: 3, max: 20 }).matches(/^[a-zA-Z0-9_ء-ي]+$/),
  body('email').trim().isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('كلمة المرور لازم 8 أحرف على الأقل'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'بيانات غير صحيحة', details: errors.array() });
    }

    const { username, email, password } = req.body;

    try {
      const existing = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
      if (existing) {
        return res.status(409).json({ error: 'البريد أو اسم المستخدم مستخدم من قبل' });
      }

      const passwordHash = await bcrypt.hash(password, 12);

      // ملاحظة: تم تعطيل تفعيل البريد الإلكتروني — الحساب يُفعّل مباشرة عند التسجيل
      // (مناسب لمشروع خاص تشاركه مع أشخاص محددين، بدون الحاجة لإعداد SMTP)
      const result = db.prepare(`
        INSERT INTO users (username, email, password_hash, is_verified)
        VALUES (?, ?, ?, 1)
      `).run(username, email, passwordHash);

      res.status(201).json({ message: 'تم إنشاء الحساب! تقدر تسجل دخولك مباشرة الحين.' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'خطأ في السيرفر' });
    }
  }
);

// ===== تفعيل الحساب عبر رابط البريد =====
router.get('/verify/:token', (req, res) => {
  const { token } = req.params;
  const user = db.prepare('SELECT * FROM users WHERE verify_token = ?').get(token);

  if (!user) {
    return res.status(400).send('رابط التفعيل غير صحيح.');
  }
  if (user.verify_token_expires < Date.now()) {
    return res.status(400).send('انتهت صلاحية رابط التفعيل، سجل حساب جديد أو اطلب رابط جديد.');
  }

  db.prepare('UPDATE users SET is_verified = 1, verify_token = NULL, verify_token_expires = NULL WHERE id = ?').run(user.id);
  res.send('<div style="font-family:Tahoma;text-align:center;padding:50px;direction:rtl;">✅ تم تفعيل حسابك بنجاح! ارجع للتطبيق وسجل دخولك.</div>');
});

// ===== تسجيل الدخول =====
router.post('/login',
  authLimiter,
  body('email').trim().isEmail().normalizeEmail(),
  body('password').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'بيانات غير صحيحة' });
    }

    const { email, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    // رسالة عامة موحّدة عشان ما نكشف هل الإيميل موجود أو لا
    const genericError = { error: 'البريد أو كلمة المرور غير صحيحة' };

    if (!user) return res.status(401).json(genericError);

    if (user.locked_until && user.locked_until > Date.now()) {
      const minutesLeft = Math.ceil((user.locked_until - Date.now()) / 60000);
      return res.status(423).json({ error: `الحساب مقفل مؤقتاً، حاول بعد ${minutesLeft} دقيقة` });
    }

    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      const attempts = user.failed_login_attempts + 1;
      if (attempts >= MAX_FAILED_ATTEMPTS) {
        db.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = ? WHERE id = ?')
          .run(Date.now() + LOCK_TIME_MS, user.id);
        return res.status(423).json({ error: 'محاولات فاشلة كثيرة، الحساب مقفل 15 دقيقة' });
      }
      db.prepare('UPDATE users SET failed_login_attempts = ? WHERE id = ?').run(attempts, user.id);
      return res.status(401).json(genericError);
    }

    if (!user.is_verified) {
      return res.status(403).json({ error: 'لازم تفعّل بريدك الإلكتروني أول' });
    }

    db.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);

    const token = signToken(user);
    res.json({ token, username: user.username });
  }
);

// ===== نسيت كلمة المرور =====
router.post('/forgot-password',
  authLimiter,
  body('email').trim().isEmail().normalizeEmail(),
  async (req, res) => {
    // ميزة البريد الإلكتروني معطّلة (المشروع بدون SMTP) — استعادة كلمة المرور غير متاحة تلقائياً
    res.json({ message: 'ميزة استعادة كلمة المرور عبر البريد غير مفعّلة حالياً. تواصل مع مسؤول الموقع.' });
  }
);

// ===== تعيين كلمة مرور جديدة =====
router.post('/reset-password',
  authLimiter,
  body('token').notEmpty(),
  body('password').isLength({ min: 8 }),
  async (req, res) => {
    const { token, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE reset_token = ?').get(token);

    if (!user || !user.reset_token_expires || user.reset_token_expires < Date.now()) {
      return res.status(400).json({ error: 'رابط غير صحيح أو منتهي' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?')
      .run(passwordHash, user.id);

    res.json({ message: 'تم تغيير كلمة المرور بنجاح' });
  }
);

module.exports = router;
