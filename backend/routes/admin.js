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
  (req, res) => {
    if (validationError(req, res)) return;
    const { name } = req.body;
    const existing = db.prepare('SELECT id FROM categories WHERE name = ?').get(name);
    if (existing) return res.status(409).json({ error: 'القسم موجود من قبل' });

    const maxOrder = db.prepare('SELECT MAX(sort_order) AS m FROM categories').get().m || 0;
    const { lastInsertRowid } = db.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)')
      .run(name, maxOrder + 1);
    res.status(201).json({ id: lastInsertRowid, name });
  }
);

router.put('/categories/:id',
  body('name').trim().isLength({ min: 1, max: 60 }),
  (req, res) => {
    if (validationError(req, res)) return;
    const result = db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(req.body.name, req.params.id);
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

module.exports = router;
