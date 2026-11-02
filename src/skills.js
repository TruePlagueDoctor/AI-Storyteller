// Сопоставление навыка из броска с умением героя. Модель почти никогда не
// повторяет название дословно: «Взлом» вместо «Взлом замков», «вскрыть замок»,
// «Скрытности». Ищем по смыслу — по общим основам слов — и берём лучшее.

const STOP = new Set(['и', 'в', 'на', 'с', 'со', 'по', 'для', 'от', 'к', 'о', 'об', 'из', 'без', 'над', 'под']);
const stem = (w) => w.slice(0, Math.max(4, Math.min(5, w.length - 1)));
export function skillStems(name) {
  return String(name || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\s-]/gu, ' ')
    .split(/[\s-]+/).filter((w) => w.length >= 4 && !STOP.has(w)).map(stem);
}

// Пары, которые по основам не совпадут, а по смыслу — одно и то же.
const SYNONYMS = [
  ['взлом', 'вскры', 'отмыч', 'замок', 'замк'],
  ['скрыт', 'красть', 'краст', 'прокр', 'тайко', 'незам'],
  ['убежд', 'уговор', 'дипло', 'перег'],
  ['обман', 'блеф', 'ложь', 'солга', 'хитр'],
  ['запуг', 'угроз', 'устра'],
  ['фехто', 'клино', 'мечом', 'меча', 'мечн', 'шпаг', 'рапир'],
  ['стрел', 'лучни', 'лука'],
  ['медиц', 'лечен', 'лекар', 'враче', 'перев'],
  ['внима', 'наблю', 'воспр', 'замеч', 'осмот'],
  ['атлет', 'лазан', 'плава', 'прыжк', 'бегом'],
  ['верхо', 'наезд', 'конно', 'лошад'],
];
const group = (s) => SYNONYMS.findIndex((g) => g.some((x) => s.startsWith(x) || x.startsWith(s)));

// Возвращает блок умения или null. Точное совпадение — сразу; иначе лучшее по общим основам
// (и по синонимам), если совпадение не случайное.
export function matchAbility(blocks, skillName) {
  const abil = (blocks || []).filter((b) => b.type === 'ability');
  const want = String(skillName || '').trim().toLowerCase();
  if (!want || !abil.length) return null;
  const exact = abil.find((b) => b.name.trim().toLowerCase() === want);
  if (exact) return exact;
  const a = skillStems(want);
  if (!a.length) return null;
  let best = null; let bestScore = 0;
  for (const b of abil) {
    const s = skillStems(b.name);
    if (!s.length) continue;
    let common = 0;
    for (const x of a) {
      if (s.some((y) => y === x || y.startsWith(x) || x.startsWith(y))) common += 1;
      else { const g = group(x); if (g !== -1 && s.some((y) => group(y) === g)) common += 0.8; }
    }
    const score = common / Math.min(a.length, s.length);
    if (score > bestScore) { bestScore = score; best = b; }
  }
  return bestScore >= 0.5 ? best : null;
}
