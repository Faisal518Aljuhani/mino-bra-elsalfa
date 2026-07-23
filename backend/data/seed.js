// تعبئة أولية لقواعد بيانات المحتوى من الملفات الثابتة القديمة
// يشتغل مرة وحدة بس (لو الجداول فاضية) عشان ما يكرر البيانات كل تشغيل
const db = require('../db');

async function seedIfEmpty() {
  const catCount = (await db.prepare('SELECT COUNT(*) AS c FROM categories').get()).c;
  if (catCount === 0) {
    const staticCategories = require('./categories');
    const insertCat = db.prepare('INSERT INTO categories (name, sort_order, is_free) VALUES (?, ?, ?)');
    const insertWord = db.prepare('INSERT INTO category_words (category_id, word) VALUES (?, ?)');
    let order = 0;
    const FREE_CATEGORIES_COUNT = 3; // أول 3 فئات مجانية دائماً، الباقي يحتاج فتح من المتجر
    for (const [name, words] of Object.entries(staticCategories)) {
      const isFree = order < FREE_CATEGORIES_COUNT ? 1 : 0;
      const { lastInsertRowid } = await insertCat.run(name, order++, isFree);
      for (const word of words) await insertWord.run(lastInsertRowid, word);
    }
    console.log(`🌱 تمت تعبئة ${order} قسم في جدول الفئات (${FREE_CATEGORIES_COUNT} مجانية والباقي بالمتجر)`);
  }

  const cfCount = (await db.prepare('SELECT COUNT(*) AS c FROM common_factor_questions').get()).c;
  if (cfCount === 0) {
    const staticQuestions = require('./common-factor');
    const insertQ = db.prepare(
      'INSERT INTO common_factor_questions (level, items, choices, answer) VALUES (?, ?, ?, ?)'
    );
    for (const q of staticQuestions) {
      await insertQ.run(q.level, JSON.stringify(q.items), JSON.stringify(q.choices), q.answer);
    }
    console.log(`🌱 تمت تعبئة ${staticQuestions.length} سؤال في جدول العامل المشترك`);
  }

  const colCount = (await db.prepare('SELECT COUNT(*) AS c FROM letters_columns').get()).c;
  if (colCount === 0) {
    const { columns, defaultColumnIds } = require('./letters-categories');
    const insertCol = db.prepare(
      'INSERT INTO letters_columns (col_key, label, emoji, is_default, sort_order) VALUES (?, ?, ?, ?, ?)'
    );
    let i = 0;
    for (const col of columns) {
      await insertCol.run(col.id, col.label, col.emoji || '', defaultColumnIds.includes(col.id) ? 1 : 0, i);
      i++;
    }
    console.log(`🌱 تمت تعبئة ${columns.length} خانة في جدول لعبة الحروف`);
  }

  const caseCount = (await db.prepare('SELECT COUNT(*) AS c FROM detective_cases').get()).c;
  if (caseCount === 0) {
    const staticCases = require('./detective-cases');
    const insertCase = db.prepare(
      'INSERT INTO detective_cases (level, story, choices, answer) VALUES (?, ?, ?, ?)'
    );
    for (const c of staticCases) {
      await insertCase.run(c.level, c.story, JSON.stringify(c.choices), c.answer);
    }
    console.log(`🌱 تمت تعبئة ${staticCases.length} قضية في جدول قصة جنائية`);
  }
}

module.exports = { seedIfEmpty };
