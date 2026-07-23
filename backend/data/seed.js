// تعبئة أولية لقواعد بيانات المحتوى من الملفات الثابتة القديمة
// يشتغل مرة وحدة بس (لو الجداول فاضية) عشان ما يكرر البيانات كل تشغيل
const db = require('../db');

function seedIfEmpty() {
  const catCount = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
  if (catCount === 0) {
    const staticCategories = require('./categories');
    const insertCat = db.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)');
    const insertWord = db.prepare('INSERT INTO category_words (category_id, word) VALUES (?, ?)');
    let order = 0;
    for (const [name, words] of Object.entries(staticCategories)) {
      const { lastInsertRowid } = insertCat.run(name, order++);
      for (const word of words) insertWord.run(lastInsertRowid, word);
    }
    console.log(`🌱 تمت تعبئة ${order} قسم في جدول الفئات`);
  }

  const cfCount = db.prepare('SELECT COUNT(*) AS c FROM common_factor_questions').get().c;
  if (cfCount === 0) {
    const staticQuestions = require('./common-factor');
    const insertQ = db.prepare(
      'INSERT INTO common_factor_questions (level, items, choices, answer) VALUES (?, ?, ?, ?)'
    );
    for (const q of staticQuestions) {
      insertQ.run(q.level, JSON.stringify(q.items), JSON.stringify(q.choices), q.answer);
    }
    console.log(`🌱 تمت تعبئة ${staticQuestions.length} سؤال في جدول العامل المشترك`);
  }

  const colCount = db.prepare('SELECT COUNT(*) AS c FROM letters_columns').get().c;
  if (colCount === 0) {
    const { columns, defaultColumnIds } = require('./letters-categories');
    const insertCol = db.prepare(
      'INSERT INTO letters_columns (col_key, label, emoji, is_default, sort_order) VALUES (?, ?, ?, ?, ?)'
    );
    columns.forEach((col, i) => {
      insertCol.run(col.id, col.label, col.emoji || '', defaultColumnIds.includes(col.id) ? 1 : 0, i);
    });
    console.log(`🌱 تمت تعبئة ${columns.length} خانة في جدول لعبة الحروف`);
  }

  const caseCount = db.prepare('SELECT COUNT(*) AS c FROM detective_cases').get().c;
  if (caseCount === 0) {
    const staticCases = require('./detective-cases');
    const insertCase = db.prepare(
      'INSERT INTO detective_cases (level, story, choices, answer) VALUES (?, ?, ?, ?)'
    );
    for (const c of staticCases) {
      insertCase.run(c.level, c.story, JSON.stringify(c.choices), c.answer);
    }
    console.log(`🌱 تمت تعبئة ${staticCases.length} قضية في جدول قصة جنائية`);
  }
}

module.exports = { seedIfEmpty };
