// بيانات لعبة "حرف، اسم، حيوان، نبات، جماد، بلاد"
// columns: كل الخانات المتاحة (الأساسية + الإضافية) — المضيف يختار منها
// defaultColumnIds: الخانات المفعّلة افتراضياً (الخمس الأساسية)
// letters: الحروف العربية اللي تُختار عشوائياً لكل جولة
// roundSeconds: مدة الجولة بالثواني (دقيقة ونصف)

const columns = [
  { id: 'name', label: 'اسم', emoji: '👤' },
  { id: 'animal', label: 'حيوان', emoji: '🐾' },
  { id: 'plant', label: 'نبات', emoji: '🌱' },
  { id: 'object', label: 'جماد', emoji: '🪑' },
  { id: 'country', label: 'بلاد', emoji: '🌍' },
  { id: 'job', label: 'مهنة', emoji: '💼' },
  { id: 'car', label: 'سيارة', emoji: '🚗' },
  { id: 'color', label: 'لون', emoji: '🎨' },
  { id: 'food', label: 'أكلة', emoji: '🍽️' },
  { id: 'player', label: 'لاعب', emoji: '⚽' },
  { id: 'city', label: 'مدينة', emoji: '🏙️' },
  { id: 'series', label: 'مسلسل', emoji: '📺' }
];

const defaultColumnIds = ['name', 'animal', 'plant', 'object', 'country'];

const letters = [
  'ا', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'س', 'ش',
  'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'ه', 'و', 'ي'
];

const roundSeconds = 90;

module.exports = { columns, defaultColumnIds, letters, roundSeconds };
