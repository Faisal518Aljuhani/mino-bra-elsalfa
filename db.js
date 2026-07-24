const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new DatabaseSync(path.join(dbDir, 'app.db'));

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// جدول المستخدمين
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_verified INTEGER DEFAULT 0,
  verify_token TEXT,
  verify_token_expires INTEGER,
  reset_token TEXT,
  reset_token_expires INTEGER,
  failed_login_attempts INTEGER DEFAULT 0,
  locked_until INTEGER,
  created_at INTEGER DEFAULT (strftime('%s','now'))
)`);

// ===== جداول متجر "لمّة كوين" =====

// محفظة الكوينز — رصيد كل مستخدم (سطر واحد لكل مستخدم)
db.exec(`
CREATE TABLE IF NOT EXISTS wallets (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  coins INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER DEFAULT (strftime('%s','now'))
)`);

// سجل حركات الكوينز (شحن، شراء، هدية اشتراك) — للتدقيق فقط
db.exec(`
CREATE TABLE IF NOT EXISTS coin_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,     -- موجب = إضافة، سالب = خصم
  reason TEXT NOT NULL,        -- 'purchase' | 'spend' | 'subscription_gift'
  reference TEXT,              -- مثلاً معرف الفتح أو معرف الفاتورة
  created_at INTEGER DEFAULT (strftime('%s','now'))
)`);

// العناصر المفتوحة بشكل دائم لكل مستخدم (فئة، قضية، كل الفئات، كل القضايا، المافيا، إزالة الإعلانات)
db.exec(`
CREATE TABLE IF NOT EXISTS unlocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL,     -- 'category' | 'case' | 'all_categories' | 'all_cases' | 'mafia' | 'remove_ads'
  item_id INTEGER,             -- رقم الفئة/القضية (فاضي للأنواع العامة)
  created_at INTEGER DEFAULT (strftime('%s','now')),
  UNIQUE(user_id, item_type, item_id)
)`);

// اشتراك "لمّة بلس" الشهري
db.exec(`
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'inactive',  -- 'active' | 'inactive' | 'expired'
  current_period_end INTEGER,               -- طابع زمني (ثواني) لنهاية الفترة المدفوعة
  last_gift_period TEXT,                    -- آخر شهر استلم فيه هدية الكوينز (YYYY-MM) لمنع تكرارها
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
)`);

// سجل المدفوعات عبر Moyasar — يمنع معالجة نفس الدفعة مرتين (idempotency)
db.exec(`
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  moyasar_invoice_id TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL,          -- 'coins' | 'subscription' | 'cart'
  reference TEXT,              -- معرف باقة الكوينز أو 'lamma_plus' (فاضي لو 'cart')
  amount_halalas INTEGER NOT NULL,
  cart_items TEXT,             -- JSON array لعناصر السلة (لو الفاتورة كانت سلة فيها أكثر من عنصر)
  coupon_code TEXT,            -- كود الخصم المستخدم (لو فيه)
  discount_halalas INTEGER DEFAULT 0, -- قيمة الخصم بالهللة
  status TEXT NOT NULL DEFAULT 'initiated', -- 'initiated' | 'paid' | 'failed'
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
)`);

// هجرة بسيطة: إضافة أعمدة السلة/الكوبون لو ما كانت موجودة (لقواعد بيانات قديمة)
try { db.exec('ALTER TABLE payments ADD COLUMN cart_items TEXT'); } catch (e) { /* العمود موجود مسبقاً */ }
try { db.exec('ALTER TABLE payments ADD COLUMN coupon_code TEXT'); } catch (e) { /* العمود موجود مسبقاً */ }
try { db.exec('ALTER TABLE payments ADD COLUMN discount_halalas INTEGER DEFAULT 0'); } catch (e) { /* العمود موجود مسبقاً */ }

// ===== جداول لوحة تحكم المشرف =====

// حسابات المشرفين (منفصلة تماماً عن حسابات اللاعبين العاديين)
db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  failed_login_attempts INTEGER DEFAULT 0,
  locked_until INTEGER,
  created_by INTEGER,
  created_at INTEGER DEFAULT (strftime('%s','now'))
)`);

// فئات لعبة "لمّة" (أقسام + كلمات كل قسم)
db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now'))
)`);

// هجرة بسيطة: إضافة عمود "مجاني؟" لجدول الفئات لو ما كان موجود (لقواعد بيانات قديمة)
try { db.exec('ALTER TABLE categories ADD COLUMN is_free INTEGER DEFAULT 0'); } catch (e) { /* العمود موجود مسبقاً */ }

db.exec(`
CREATE TABLE IF NOT EXISTS category_words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  word TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s','now'))
)`);

// أسئلة لعبة "العامل المشترك"
db.exec(`
CREATE TABLE IF NOT EXISTS common_factor_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level INTEGER NOT NULL DEFAULT 1,
  items TEXT NOT NULL,     -- JSON array
  choices TEXT NOT NULL,   -- JSON array
  answer TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s','now'))
)`);

// خانات لعبة "حرف، اسم، حيوان، نبات، جماد، بلاد"
db.exec(`
CREATE TABLE IF NOT EXISTS letters_columns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  col_key TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  emoji TEXT DEFAULT '',
  is_default INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now'))
)`);

// قضايا لعبة "قصة جنائية" — حل قضايا غامضة بالتفكير والتحليل
db.exec(`
CREATE TABLE IF NOT EXISTS detective_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level INTEGER NOT NULL DEFAULT 1,  -- 1 سهل، 2 متوسط، 3 صعب
  story TEXT NOT NULL,
  choices TEXT NOT NULL,   -- JSON array (4 خيارات)
  answer TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s','now'))
)`);

module.exports = db;
