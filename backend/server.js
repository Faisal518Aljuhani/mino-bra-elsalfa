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
const setupGameSockets = require('./socket/game');
const setupLettersGameSockets = require('./socket/lettersGame');

// تعبئة أولية لقواعد بيانات المحتوى (لو فاضية) + إنشاء أول حساب مشرف
seedIfEmpty();
bootstrapAdmin();

const app = express();
const server = http.createServer(app);

// ===== حماية أساسية =====
app.use(helmet({
  contentSecurityPolicy: false // مبسّط للتشغيل المحلي، فعّله بإعدادات مخصصة لو نشرت المشروع لاحقاً
}));
app.use(cors({ origin: allowedOrigin }));
app.use(express.json({ limit: '10kb' })); // يمنع أجسام طلبات ضخمة (DoS بسيط)

// ===== المسارات =====
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

// ===== تقديم الفرونت إند =====
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ ok: true }));

// وضع "جهاز واحد" (تمرير الجهاز) لا يحتاج تسجيل دخول، فقط قائمة الفئات والكلمات كاملة
// المحتوى الآن يُقرأ من قاعدة البيانات (يقدر المشرف يعدّله من لوحة التحكم) بنفس شكل البيانات القديم
app.get('/api/categories', (req, res) => {
  const cats = db.prepare('SELECT * FROM categories ORDER BY sort_order, id').all();
  const words = db.prepare('SELECT * FROM category_words ORDER BY id').all();
  const byCategory = {};
  for (const w of words) (byCategory[w.category_id] ||= []).push(w.word);
  const result = {};
  for (const c of cats) result[c.name] = byCategory[c.id] || [];
  res.json(result);
});

// لعبة العامل المشترك — لا تحتاج تسجيل دخول أيضاً
app.get('/api/common-factor', (req, res) => {
  const rows = db.prepare('SELECT * FROM common_factor_questions ORDER BY id').all();
  res.json(rows.map(r => ({
    level: r.level,
    items: JSON.parse(r.items),
    choices: JSON.parse(r.choices),
    answer: r.answer
  })));
});

// لعبة حرف اسم حيوان نبات جماد بلاد (وضع جهاز واحد) — لا تحتاج تسجيل دخول
app.get('/api/letters-categories', (req, res) => {
  const rows = db.prepare('SELECT * FROM letters_columns ORDER BY sort_order, id').all();
  const columns = rows.map(r => ({ id: r.col_key, label: r.label, emoji: r.emoji }));
  const defaultColumnIds = rows.filter(r => r.is_default).map(r => r.col_key);
  const { letters, roundSeconds } = require('./data/letters-categories');
  res.json({ columns, defaultColumnIds, letters, roundSeconds });
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
