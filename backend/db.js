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

// فئات لعبة "مين برا السالفة" (أقسام + كلمات كل قسم)
db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now'))
)`);

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

module.exports = db;
