require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const { Server } = require('socket.io');

// استضافات مثل Render تعطي رابط HTTPS خاص بها وتمرر PORT تلقائياً عبر متغير بيئة
const allowedOrigin = process.env.APP_BASE_URL || '*';

const authRoutes = require('./routes/auth');
const setupGameSockets = require('./socket/game');
const setupLettersGameSockets = require('./socket/lettersGame');
const categories = require('./data/categories');
const commonFactorQuestions = require('./data/common-factor');
const lettersCategories = require('./data/letters-categories');

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

// ===== تقديم الفرونت إند =====
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ ok: true }));

// وضع "جهاز واحد" (تمرير الجهاز) لا يحتاج تسجيل دخول، فقط قائمة الفئات والكلمات كاملة
app.get('/api/categories', (req, res) => res.json(categories));

// لعبة العامل المشترك — لا تحتاج تسجيل دخول أيضاً
app.get('/api/common-factor', (req, res) => res.json(commonFactorQuestions));

// لعبة حرف اسم حيوان نبات جماد بلاد (وضع جهاز واحد) — لا تحتاج تسجيل دخول
app.get('/api/letters-categories', (req, res) => res.json(lettersCategories));

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
