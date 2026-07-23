const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { signAdminToken, requireAdmin } = require('../utils/adminAuth');

const router = express.Router();

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_TIME_MS = 15 * 60 * 1000;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'محاولات كثيرة، حاول بعد شوي' },
  standardHeaders: true,
  legacyHeaders: false
});

function validationError(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: 'بيانات غير صحيحة', details: errors.array() });
    return true;
  }
  return false;
}

// ===================== تسجيل دخول المشرف =====================
router.post('/login',
  loginLimiter,
  body('username').trim().notEmpty(),
  body('password').notEmpty(),
  async (req, res) => {
    if (validationError(req, res)) return;

    const { username, password } = req.body;
    const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);

    const genericError = { error: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
    if (!admin) return res.status(401).json(genericError);

    if (admin.locked_until && admin.locked_until > Date.now()) {
      const minutesLeft = Math.ceil((admin.locked_until - Date.now()) / 60000);
      return res.status(423).json({ error: `الحساب مقفل مؤقتاً، حاول بعد ${minutesLeft} دقيقة` });
    }

    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match) {
      const attempts = admin.failed_login_attempts + 1;
      if (attempts >= MAX_FAILED_ATTEMPTS) {
        db.prepare('UPDATE admins SET failed_login_attempts = 0, locked_until = ? WHERE id = ?')
          .run(Date.now() + LOCK_TIME_MS, admin.id);
        return res.status(423).json({ error: 'محاولات فاشلة كثيرة، الحساب مقفل 15 دقيقة' });
      }
      db.prepare('UPDATE admins SET failed_login_attempts = ? WHERE id = ?').run(attempts, admin.id);
      return res.status(401).json(genericError);
    }

    db.prepare('UPDATE admins SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?').run(admin.id);
    const token = signAdminToken(admin);
    res.json({ token, username: admin.username });
  }
);

router.get('/me', requireAdmin, (req, res) => {
  res.json({ id: req.admin.id, username: req.admin.username });
});

// كل ما بعد هذا السطر يتطلب تسجيل دخول مشرف
router.use(requireAdmin);

// ===================== إدارة المشرفين =====================
router.get('/admins', (req, res) => {
  const admins = db.prepare('SELECT id, username, created_at FROM admins ORDER BY id').all();
  res.json(admins);
});

router.post('/admins',
  body('username').trim().isLength({ min: 3, max: 40 }),
  body('password').isLength({ min: 8 }).withMessage('كلمة المرور لازم 8 أحرف على الأقل'),
  async (req, res) => {
    if (validationError(req, res)) return;
    const { username, password } = req.body;

    const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
    if (existing) return res.status(409).json({ error: 'اسم المستخدم مستخدم من قبل' });

    const passwordHash = await bcrypt.hash(password, 12);
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO admins (username, password_hash, created_by) VALUES (?, ?, ?)'
    ).run(username, passwordHash, req.admin.id);

    res.status(201).json({ id: lastInsertRowid, username });
  }
);

router.delete('/admins/:id', (req, res) => {
  const id = Number(req.params.id);

  if (id === req.admin.id) {
    return res.status(400).json({ error: 'ما تقدر تحذف حسابك أنت وأنت داخل فيه' });
  }

  const total = db.prepare('SELECT COUNT(*) AS c FROM admins').get().c;
  if (total <= 1) {
    return res.status(400).json({ error: 'لازم يبقى مشرف واحد على الأقل' });
  }

  const result = db.prepare('DELETE FROM admins WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'المشرف غير موجود' });
  res.json({ message: 'تم حذف المشرف' });
});

// ===================== فئات لعبة "لمّة" =====================
router.get('/categories', (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order, id').all();
  const words = db.prepare('SELECT * FROM category_words ORDER BY id').all();
  const byCategory = {};
  for (const w of words) {
    (byCategory[w.category_id] ||= []).push({ id: w.id, word: w.word });
  }
  res.json(categories.map(c => ({ ...c, words: byCategory[c.id] || [] })));
});

router.post('/categories',
  body('name').trim().isLength({ min: 1, max: 60 }),
  body('is_free').optional().isBoolean(),
  (req, res) => {
    if (validationError(req, res)) return;
    const { name, is_free } = req.body;
    const existing = db.prepare('SELECT id FROM categories WHERE name = ?').get(name);
    if (existing) return res.status(409).json({ error: 'القسم موجود من قبل' });

    const maxOrder = db.prepare('SELECT MAX(sort_order) AS m FROM categories').get().m || 0;
    const { lastInsertRowid } = db.prepare('INSERT INTO categories (name, sort_order, is_free) VALUES (?, ?, ?)')
      .run(name, maxOrder + 1, is_free ? 1 : 0);
    res.status(201).json({ id: lastInsertRowid, name });
  }
);

router.put('/categories/:id',
  body('name').trim().isLength({ min: 1, max: 60 }),
  body('is_free').optional().isBoolean(),
  (req, res) => {
    if (validationError(req, res)) return;
    const result = db.prepare('UPDATE categories SET name = ?, is_free = ? WHERE id = ?')
      .run(req.body.name, req.body.is_free ? 1 : 0, req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'القسم غير موجود' });
    res.json({ message: 'تم التحديث' });
  }
);

router.delete('/categories/:id', (req, res) => {
  const result = db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'القسم غير موجود' });
  res.json({ message: 'تم الحذف' });
});

router.post('/categories/:id/words',
  body('word').trim().isLength({ min: 1, max: 80 }),
  (req, res) => {
    if (validationError(req, res)) return;
    const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(req.params.id);
    if (!category) return res.status(404).json({ error: 'القسم غير موجود' });

    const { lastInsertRowid } = db.prepare('INSERT INTO category_words (category_id, word) VALUES (?, ?)')
      .run(req.params.id, req.body.word);
    res.status(201).json({ id: lastInsertRowid, word: req.body.word });
  }
);

router.put('/words/:id',
  body('word').trim().isLength({ min: 1, max: 80 }),
  (req, res) => {
    if (validationError(req, res)) return;
    const result = db.prepare('UPDATE category_words SET word = ? WHERE id = ?').run(req.body.word, req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'الكلمة غير موجودة' });
    res.json({ message: 'تم التحديث' });
  }
);

router.delete('/words/:id', (req, res) => {
  const result = db.prepare('DELETE FROM category_words WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'الكلمة غير موجودة' });
  res.json({ message: 'تم الحذف' });
});

// ===================== أسئلة "العامل المشترك" =====================
router.get('/common-factor', (req, res) => {
  const rows = db.prepare('SELECT * FROM common_factor_questions ORDER BY id').all();
  res.json(rows.map(r => ({
    id: r.id,
    level: r.level,
    items: JSON.parse(r.items),
    choices: JSON.parse(r.choices),
    answer: r.answer
  })));
});

router.post('/common-factor',
  body('level').isInt({ min: 1, max: 3 }),
  body('items').isArray({ min: 2 }),
  body('choices').isArray({ min: 2 }),
  body('answer').trim().notEmpty(),
  (req, res) => {
    if (validationError(req, res)) return;
    const { level, items, choices, answer } = req.body;
    if (!choices.includes(answer)) {
      return res.status(400).json({ error: 'الإجابة الصحيحة لازم تكون ضمن الخيارات' });
    }
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO common_factor_questions (level, items, choices, answer) VALUES (?, ?, ?, ?)'
    ).run(level, JSON.stringify(items), JSON.stringify(choices), answer);
    res.status(201).json({ id: lastInsertRowid });
  }
);

router.put('/common-factor/:id',
  body('level').isInt({ min: 1, max: 3 }),
  body('items').isArray({ min: 2 }),
  body('choices').isArray({ min: 2 }),
  body('answer').trim().notEmpty(),
  (req, res) => {
    if (validationError(req, res)) return;
    const { level, items, choices, answer } = req.body;
    if (!choices.includes(answer)) {
      return res.status(400).json({ error: 'الإجابة الصحيحة لازم تكون ضمن الخيارات' });
    }
    const result = db.prepare(
      'UPDATE common_factor_questions SET level = ?, items = ?, choices = ?, answer = ? WHERE id = ?'
    ).run(level, JSON.stringify(items), JSON.stringify(choices), answer, req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'السؤال غير موجود' });
    res.json({ message: 'تم التحديث' });
  }
);

router.delete('/common-factor/:id', (req, res) => {
  const result = db.prepare('DELETE FROM common_factor_questions WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'السؤال غير موجود' });
  res.json({ message: 'تم الحذف' });
});

// ===================== خانات لعبة الحروف =====================
router.get('/letters-columns', (req, res) => {
  const rows = db.prepare('SELECT * FROM letters_columns ORDER BY sort_order, id').all();
  res.json(rows);
});

router.post('/letters-columns',
  body('col_key').trim().isLength({ min: 1, max: 30 }).matches(/^[a-zA-Z0-9_]+$/),
  body('label').trim().isLength({ min: 1, max: 30 }),
  body('emoji').optional({ checkFalsy: true }).trim().isLength({ max: 10 }),
  body('is_default').optional().isBoolean(),
  (req, res) => {
    if (validationError(req, res)) return;
    const { col_key, label, emoji, is_default } = req.body;
    const existing = db.prepare('SELECT id FROM letters_columns WHERE col_key = ?').get(col_key);
    if (existing) return res.status(409).json({ error: 'المعرف مستخدم من قبل' });

    const maxOrder = db.prepare('SELECT MAX(sort_order) AS m FROM letters_columns').get().m || 0;
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO letters_columns (col_key, label, emoji, is_default, sort_order) VALUES (?, ?, ?, ?, ?)'
    ).run(col_key, label, emoji || '', is_default ? 1 : 0, maxOrder + 1);
    res.status(201).json({ id: lastInsertRowid });
  }
);

router.put('/letters-columns/:id',
  body('label').trim().isLength({ min: 1, max: 30 }),
  body('emoji').optional({ checkFalsy: true }).trim().isLength({ max: 10 }),
  body('is_default').optional().isBoolean(),
  (req, res) => {
    if (validationError(req, res)) return;
    const { label, emoji, is_default } = req.body;
    const result = db.prepare(
      'UPDATE letters_columns SET label = ?, emoji = ?, is_default = ? WHERE id = ?'
    ).run(label, emoji || '', is_default ? 1 : 0, req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'الخانة غير موجودة' });
    res.json({ message: 'تم التحديث' });
  }
);

router.delete('/letters-columns/:id', (req, res) => {
  const result = db.prepare('DELETE FROM letters_columns WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'الخانة غير موجودة' });
  res.json({ message: 'تم الحذف' });
});

// ===================== قضايا "قصة جنائية" =====================
router.get('/detective-cases', (req, res) => {
  const rows = db.prepare('SELECT * FROM detective_cases ORDER BY id').all();
  res.json(rows.map(r => ({
    id: r.id,
    level: r.level,
    story: r.story,
    choices: JSON.parse(r.choices),
    answer: r.answer
  })));
});

router.post('/detective-cases',
  body('level').isInt({ min: 1, max: 3 }),
  body('story').trim().notEmpty(),
  body('choices').isArray({ min: 2 }),
  body('answer').trim().notEmpty(),
  (req, res) => {
    if (validationError(req, res)) return;
    const { level, story, choices, answer } = req.body;
    if (!choices.includes(answer)) {
      return res.status(400).json({ error: 'الإجابة الصحيحة لازم تكون ضمن الخيارات' });
    }
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO detective_cases (level, story, choices, answer) VALUES (?, ?, ?, ?)'
    ).run(level, story, JSON.stringify(choices), answer);
    res.status(201).json({ id: lastInsertRowid });
  }
);

router.put('/detective-cases/:id',
  body('level').isInt({ min: 1, max: 3 }),
  body('story').trim().notEmpty(),
  body('choices').isArray({ min: 2 }),
  body('answer').trim().notEmpty(),
  (req, res) => {
    if (validationError(req, res)) return;
    const { level, story, choices, answer } = req.body;
    if (!choices.includes(answer)) {
      return res.status(400).json({ error: 'الإجابة الصحيحة لازم تكون ضمن الخيارات' });
    }
    const result = db.prepare(
      'UPDATE detective_cases SET level = ?, story = ?, choices = ?, answer = ? WHERE id = ?'
    ).run(level, story, JSON.stringify(choices), answer, req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'القضية غير موجودة' });
    res.json({ message: 'تم التحديث' });
  }
);

router.delete('/detective-cases/:id', (req, res) => {
  const result = db.prepare('DELETE FROM detective_cases WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'القضية غير موجودة' });
  res.json({ message: 'تم الحذف' });
});

// ===================== المتجر: بحث المستخدمين وصلاحياتهم =====================
router.get('/shop/users', (req, res) => {
  const q = (req.query.q || '').trim();
  let users;
  if (q) {
    users = db.prepare(
      'SELECT id, username, email FROM users WHERE username LIKE ? OR email LIKE ? ORDER BY id DESC LIMIT 20'
    ).all(`%${q}%`, `%${q}%`);
  } else {
    users = db.prepare('SELECT id, username, email FROM users ORDER BY id DESC LIMIT 20').all();
  }

  const result = users.map(u => {
    const wallet = db.prepare('SELECT coins FROM wallets WHERE user_id = ?').get(u.id);
    const sub = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(u.id);
    const unlocks = db.prepare('SELECT item_type, item_id FROM unlocks WHERE user_id = ?').all(u.id);
    const now = Math.floor(Date.now() / 1000);
    return {
      id: u.id,
      username: u.username,
      email: u.email,
      coins: wallet ? wallet.coins : 0,
      subscriptionActive: !!(sub && sub.status === 'active' && sub.current_period_end > now),
      subscriptionPeriodEnd: sub ? sub.current_period_end : null,
      unlocks
    };
  });

  res.json(result);
});

// ===== سجل المدفوعات (للمراجعة والدعم الفني) =====
router.get('/shop/payments', (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, u.username
    FROM payments p JOIN users u ON u.id = p.user_id
    ORDER BY p.id DESC LIMIT 50
  `).all();
  res.json(rows);
});

// ===== إضافة/خصم كوينز يدوياً (دعم فني: دفعة فشلت، تعويض، إلخ) =====
router.post('/shop/grant-coins',
  body('userId').isInt(),
  body('amount').isInt().custom(v => v !== 0).withMessage('لازم رقم غير صفر'),
  body('reason').trim().isLength({ min: 1, max: 100 }),
  (req, res) => {
    if (validationError(req, res)) return;
    const { userId, amount, reason } = req.body;

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    db.prepare('INSERT OR IGNORE INTO wallets (user_id, coins) VALUES (?, 0)').run(userId);
    const wallet = db.prepare('SELECT coins FROM wallets WHERE user_id = ?').get(userId);
    if (wallet.coins + amount < 0) {
      return res.status(400).json({ error: 'ما يصير الرصيد يصير سالب' });
    }

    db.prepare('UPDATE wallets SET coins = coins + ?, updated_at = strftime(\'%s\',\'now\') WHERE user_id = ?').run(amount, userId);
    db.prepare('INSERT INTO coin_transactions (user_id, amount, reason, reference) VALUES (?, ?, ?, ?)')
      .run(userId, amount, 'admin_adjust', `${reason} (بواسطة: ${req.admin.username})`);

    const updated = db.prepare('SELECT coins FROM wallets WHERE user_id = ?').get(userId);
    res.json({ ok: true, coins: updated.coins });
  }
);

// ===== منح اشتراك "لمّة بلس" يدوياً (تعويض/دعم فني) =====
router.post('/shop/grant-subscription',
  body('userId').isInt(),
  body('days').isInt({ min: 1, max: 365 }),
  (req, res) => {
    if (validationError(req, res)) return;
    const { userId, days } = req.body;

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const now = Math.floor(Date.now() / 1000);
    const existing = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId);
    const base = existing && existing.current_period_end > now ? existing.current_period_end : now;
    const periodEnd = base + days * 24 * 60 * 60;

    if (existing) {
      db.prepare(`UPDATE subscriptions SET status = 'active', current_period_end = ?, updated_at = strftime('%s','now') WHERE user_id = ?`)
        .run(periodEnd, userId);
    } else {
      db.prepare(`INSERT INTO subscriptions (user_id, status, current_period_end) VALUES (?, 'active', ?)`)
        .run(userId, periodEnd);
    }
    res.json({ ok: true, subscriptionPeriodEnd: periodEnd });
  }
);

// ===== إلغاء الاشتراك يدوياً =====
router.post('/shop/revoke-subscription',
  body('userId').isInt(),
  (req, res) => {
    if (validationError(req, res)) return;
    const result = db.prepare(`UPDATE subscriptions SET status = 'inactive', updated_at = strftime('%s','now') WHERE user_id = ?`)
      .run(req.body.userId);
    if (result.changes === 0) return res.status(404).json({ error: 'ما فيه اشتراك لهذا المستخدم' });
    res.json({ ok: true });
  }
);

// ===== منح عنصر مفتوح يدوياً (مافيا، إزالة إعلانات، كل الفئات، كل القضايا، فئة/قضية محددة) =====
router.post('/shop/grant-unlock',
  body('userId').isInt(),
  body('itemType').isIn(['category', 'case', 'all_categories', 'all_cases', 'mafia', 'remove_ads']),
  body('itemId').optional({ nullable: true }).isInt(),
  (req, res) => {
    if (validationError(req, res)) return;
    const { userId, itemType } = req.body;
    const needsId = itemType === 'category' || itemType === 'case';
    const itemId = needsId ? req.body.itemId : null;
    if (needsId && !Number.isInteger(itemId)) return res.status(400).json({ error: 'رقم العنصر مطلوب' });

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    try {
      db.prepare('INSERT INTO unlocks (user_id, item_type, item_id) VALUES (?, ?, ?)').run(userId, itemType, itemId);
    } catch (e) {
      return res.status(409).json({ error: 'هذا العنصر مفتوح مسبقاً لهذا المستخدم' });
    }
    res.json({ ok: true });
  }
);

// ===== سحب عنصر مفتوح (تصحيح خطأ) =====
router.post('/shop/revoke-unlock',
  body('userId').isInt(),
  body('itemType').trim().notEmpty(),
  body('itemId').optional({ nullable: true }).isInt(),
  (req, res) => {
    if (validationError(req, res)) return;
    const { userId, itemType } = req.body;
    const itemId = req.body.itemId ?? null;
    const result = db.prepare('DELETE FROM unlocks WHERE user_id = ? AND item_type = ? AND item_id IS ?')
      .run(userId, itemType, itemId);
    if (result.changes === 0) return res.status(404).json({ error: 'العنصر غير موجود عند هذا المستخدم' });
    res.json({ ok: true });
  }
);

module.exports = router;
