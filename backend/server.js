require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const { Server } = require('socket.io');

// استضافات مثل Render تعطي رابط HTTPS خاص بها وتمرر PORT تلقائياً عبر متغير بيئة
const allowedOrigin = process.env.APP_BASE_URL || '*';

const db = require('./db');
const { seedIfEmpty } = require('./data/seed');
const { bootstrapAdmin } = require('./utils/adminAuth');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const shopRoutes = require('./routes/shop');
const { optionalAuth } = require('./utils/authMiddleware');
const { getUserAccess, canSeeCategory, canSeeCase } = require('./utils/entitlements');
const setupGameSockets = require('./socket/game');
const setupLettersGameSockets = require('./socket/lettersGame');

// تعبئة أولية لقواعد بيانات المحتوى (لو فاضية) + إنشاء أول حساب مشرف
seedIfEmpty();
bootstrapAdmin();

const app = express();
const server = http.createServer(app);

// استضافات مثل Render تحط تطبيقك خلف بروكسي، وتمرر IP الزائر الحقيقي عبر X-Forwarded-For
// بدون هذا السطر، express-rate-limit ما يقدر يحدد IP كل مستخدم بشكل صحيح
app.set('trust proxy', 1);

// ===== حماية أساسية =====
app.use(helmet({
  contentSecurityPolicy: false // مبسّط للتشغيل المحلي، فعّله بإعدادات مخصصة لو نشرت المشروع لاحقاً
}));
app.use(cors({ origin: allowedOrigin }));
app.use(express.json({ limit: '10kb' })); // يمنع أجسام طلبات ضخمة (DoS بسيط)

// ===== المسارات =====
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/shop', shopRoutes);

// ===== تقديم الفرونت إند =====
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ ok: true }));

// وضع "جهاز واحد" (تمرير الجهاز) لا يحتاج تسجيل دخول، لكن الفئات المدفوعة تُصفّى حسب اشتراك/فتوحات المستخدم لو مسجل دخوله
// المحتوى يُقرأ من قاعدة البيانات (يقدر المشرف يعدّله من لوحة التحكم) بنفس شكل البيانات القديم
app.get('/api/categories', optionalAuth, async (req, res) => {
  const cats = await db.prepare('SELECT * FROM categories ORDER BY sort_order, id').all();
  const words = await db.prepare('SELECT * FROM category_words ORDER BY id').all();
  const byCategory = {};
  for (const w of words) (byCategory[w.category_id] ||= []).push(w.word);

  const access = getUserAccess(req.user && req.user.id);
  const result = {};
  for (const c of cats) {
    if (!canSeeCategory(access, c)) continue;
    result[c.name] = byCategory[c.id] || [];
  }
  res.json(result);
});

// قائمة كل الفئات مع حالة القفل (مستخدمة بواجهة المتجر لعرض "فتح فئة واحدة")
app.get('/api/categories-status', optionalAuth, async (req, res) => {
  const cats = await db.prepare('SELECT * FROM categories ORDER BY sort_order, id').all();
  const access = getUserAccess(req.user && req.user.id);
  res.json(cats.map(c => ({ id: c.id, name: c.name, unlocked: canSeeCategory(access, c) })));
});

// لعبة العامل المشترك — لا تحتاج تسجيل دخول أيضاً
app.get('/api/common-factor', async (req, res) => {
  const rows = await db.prepare('SELECT * FROM common_factor_questions ORDER BY id').all();
  res.json(rows.map(r => ({
    level: r.level,
    items: JSON.parse(r.items),
    choices: JSON.parse(r.choices),
    answer: r.answer
  })));
});

// لعبة حرف اسم حيوان نبات جماد بلاد (وضع جهاز واحد) — لا تحتاج تسجيل دخول
app.get('/api/letters-categories', async (req, res) => {
  const rows = await db.prepare('SELECT * FROM letters_columns ORDER BY sort_order, id').all();
  const columns = rows.map(r => ({ id: r.col_key, label: r.label, emoji: r.emoji }));
  const defaultColumnIds = rows.filter(r => r.is_default).map(r => r.col_key);
  const { letters, roundSeconds } = require('./data/letters-categories');
  res.json({ columns, defaultColumnIds, letters, roundSeconds });
});

// لعبة "قصة جنائية" — كل القضايا مدفوعة (فردياً أو دفعة وحدة أو باشتراك لمّة بلس)
app.get('/api/detective-cases', optionalAuth, async (req, res) => {
  const rows = await db.prepare('SELECT * FROM detective_cases ORDER BY id').all();
  const access = getUserAccess(req.user && req.user.id);
  const accessible = rows.filter(r => canSeeCase(access, r.id));
  res.json(accessible.map(r => ({
    level: r.level,
    story: r.story,
    choices: JSON.parse(r.choices),
    answer: r.answer
  })));
});

// قائمة كل القضايا مع حالة القفل (لواجهة المتجر: فتح قضية واحدة)
app.get('/api/detective-cases-status', optionalAuth, async (req, res) => {
  const rows = await db.prepare('SELECT id, level FROM detective_cases ORDER BY id').all();
  const access = getUserAccess(req.user && req.user.id);
  res.json(rows.map(r => ({ id: r.id, level: r.level, unlocked: canSeeCase(access, r.id) })));
});

// ===== Socket.io مع نفس إعدادات CORS =====
const io = new Server(server, {
  cors: { origin: allowedOrigin }
});
setupGameSockets(io);
setupLettersGameSockets(io);

// استضافات مثل Render تحدد رقم المنفذ تلقائياً عبر متغير PORT، لا تغيّره يدوياً هناك
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ السيرفر يشتغل على http://localhost:${PORT}`);
});
