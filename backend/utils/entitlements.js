// ===================== صلاحيات المستخدم بالمتجر =====================
// دوال مشتركة تحسب وش يملك المستخدم (كوينز، اشتراك، عناصر مفتوحة)
// تستخدم بمسارات المتجر (routes/shop.js) وبمسارات المحتوى (server.js) لتصفية الفئات/القضايا المدفوعة

const db = require('../db');

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function ensureWallet(userId) {
  db.prepare('INSERT OR IGNORE INTO wallets (user_id, coins) VALUES (?, 0)').run(userId);
  return db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId);
}

function getSubscription(userId) {
  const sub = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId);
  if (!sub) return null;
  const active = sub.status === 'active' && sub.current_period_end && sub.current_period_end > nowSeconds();
  return { ...sub, active };
}

// يرجع كل صلاحيات المستخدم بضربة وحدة (يستخدم لتصفية الفئات/القضايا وحماية المافيا)
function getUserAccess(userId) {
  if (!userId) {
    return {
      subscriptionActive: false,
      hasAllCategories: false,
      hasAllCases: false,
      hasMafia: false,
      hasRemoveAds: false,
      categoryIds: new Set(),
      caseIds: new Set()
    };
  }

  const sub = getSubscription(userId);
  const subscriptionActive = !!(sub && sub.active);

  const rows = db.prepare('SELECT item_type, item_id FROM unlocks WHERE user_id = ?').all(userId);

  const access = {
    subscriptionActive,
    hasAllCategories: subscriptionActive,
    hasAllCases: subscriptionActive,
    hasMafia: subscriptionActive,
    hasRemoveAds: subscriptionActive,
    categoryIds: new Set(),
    caseIds: new Set()
  };

  for (const r of rows) {
    if (r.item_type === 'all_categories') access.hasAllCategories = true;
    else if (r.item_type === 'all_cases') access.hasAllCases = true;
    else if (r.item_type === 'mafia') access.hasMafia = true;
    else if (r.item_type === 'remove_ads') access.hasRemoveAds = true;
    else if (r.item_type === 'category') access.categoryIds.add(r.item_id);
    else if (r.item_type === 'case') access.caseIds.add(r.item_id);
  }

  return access;
}

function canSeeCategory(access, category) {
  if (category.is_free) return true;
  if (access.hasAllCategories) return true;
  return access.categoryIds.has(category.id);
}

function canSeeCase(access, caseId) {
  if (access.hasAllCases) return true;
  return access.caseIds.has(caseId);
}

module.exports = { ensureWallet, getSubscription, getUserAccess, canSeeCategory, canSeeCase, nowSeconds };
