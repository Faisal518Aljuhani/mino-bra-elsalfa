// ===================== الاتصال بقاعدة البيانات (Turso / libSQL) =====================
// قاعدة البيانات صارت مستضافة خارجياً (مجانية عبر Turso) بدل ملف SQLite محلي،
// عشان البيانات ما تنفقد كل مرة يعيد الاستضافة (Render) تشغيل السيرفر.
// لازم تضبط TURSO_DATABASE_URL و TURSO_AUTH_TOKEN بمتغيرات البيئة (.env أو إعدادات Render).

const { createClient } = require('@libsql/client');

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) {
  throw new Error('TURSO_DATABASE_URL غير موجود بمتغيرات البيئة — أضفه بإعدادات Render (Environment) أو ملف .env');
}

const client = createClient({ url, authToken });

// يحوّل صف النتيجة لكائن JS عادي (بدل كائن Row الخاص بمكتبة libsql)
function normalizeRow(row) {
  return row ? { ...row } : undefined;
}

// طبقة توافق تحاكي شكل db.prepare(sql).get/run/all(...) القديم، لكن كل دالة صارت غير متزامنة (Promise)
// هذا يقلل حجم التغييرات بباقي الملفات لأقصى حد ممكن
function prepare(sql) {
  return {
    async get(...args) {
      const rs = await client.execute({ sql, args });
      return normalizeRow(rs.rows[0]);
    },
    async all(...args) {
      const rs = await client.execute({ sql, args });
      return rs.rows.map(normalizeRow);
    },
    async run(...args) {
      const rs = await client.execute({ sql, args });
      return {
        lastInsertRowid: Number(rs.lastInsertRowid),
        changes: rs.rowsAffected
      };
    }
  };
}

// ينفذ أمر SQL وحيد بدون معاملات (يستخدم لإنشاء/تعديل الجداول)
async function exec(sql) {
  await client.execute(sql);
}

// ===== تهيئة كل جداول قاعدة البيانات — تُستدعى مرة وحدة عند بدء تشغيل السيرفر =====
async function initSchema() {
  // جدول المستخدمين
  await exec(`
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
  await exec(`
CREATE TABLE IF NOT EXISTS wallets (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  coins INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER DEFAULT (strftime('%s','now'))
)`);

  // سجل حركات الكوينز (شحن، شراء، هدية اشتراك) — للتدقيق فقط
  await exec(`
CREATE TABLE IF NOT EXISTS coin_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  reference TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now'))
)`);

  // العناصر المفتوحة بشكل دائم لكل مستخدم
  await exec(`
CREATE TABLE IF NOT EXISTS unlocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL,
  item_id INTEGER,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  UNIQUE(user_id, item_type, item_id)
)`);

  // اشتراك "لمّة بلس" الشهري
  await exec(`
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'inactive',
  current_period_end INTEGER,
  last_gift_period TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
)`);

  // سجل المدفوعات عبر Moyasar — يمنع معالجة نفس الدفعة مرتين (idempotency)
  await exec(`
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  moyasar_invoice_id TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL,
  reference TEXT NOT NULL,
  amount_halalas INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'initiated',
  cart_items TEXT,
  coupon_code TEXT,
  discount_halalas INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
)`);

  // كوبونات الخصم
  await exec(`
CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  discount_type TEXT NOT NULL DEFAULT 'percent',
  discount_value REAL NOT NULL,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s','now'))
)`);

  // سجل استخدام كل كوبون لكل مستخدم
  await exec(`
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coupon_id INTEGER NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  UNIQUE(coupon_id, user_id)
)`);

  // ===== جداول لوحة تحكم المشرف =====

  await exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  failed_login_attempts INTEGER DEFAULT 0,
  locked_until INTEGER,
  created_by INTEGER,
  created_at INTEGER DEFAULT (strftime('%s','now'))
)`);

  await exec(`
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_free INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now'))
)`);

  await exec(`
CREATE TABLE IF NOT EXISTS category_words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  word TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s','now'))
)`);

  await exec(`
CREATE TABLE IF NOT EXISTS common_factor_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level INTEGER NOT NULL DEFAULT 1,
  items TEXT NOT NULL,
  choices TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s','now'))
)`);

  await exec(`
CREATE TABLE IF NOT EXISTS letters_columns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  col_key TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  emoji TEXT DEFAULT '',
  is_default INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now'))
)`);

  await exec(`
CREATE TABLE IF NOT EXISTS detective_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level INTEGER NOT NULL DEFAULT 1,
  story TEXT NOT NULL,
  choices TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s','now'))
)`);
}

module.exports = { prepare, exec, initSchema };
