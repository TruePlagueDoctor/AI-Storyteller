// Совпадение ключевого слова с текстом с учётом русской морфологии (общая для кодекса и рассказчика).

// Сопоставление с учётом русской морфологии: для длинных ключей ищем слово,
// начинающееся с основы (чтобы «маяк» ловил «маяка», «маяком»);
// фразы — по точному вхождению; короткие ключи — отдельным словом с возможным
// падежным окончанием: «кот» ловит «кота», но не «котёл».
const SHORT_ENDING = '(?:ь|й|а|у|е|ом|ем|ой|ою|ы|и|ю|я|ям|ам|ях|ах|ов|ев|ей)?';
export function keyMatches(key, haystack) {
  const k = String(key).toLowerCase().trim();
  if (!k) return false;
  if (k.includes(' ')) return haystack.includes(k);
  const short = k.length < 4;
  // «эль» → «эл» + окончание: «эля», «элем».
  const stem = short ? k.replace(/[ьй]$/, '') : k.length > 5 ? k.slice(0, Math.max(4, k.length - 2)) : k;
  const esc = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    const tail = short ? `${SHORT_ENDING}(?![\\p{L}])` : '\\p{L}*';
    return new RegExp(`(^|[^\\p{L}])${esc}${tail}`, 'u').test(haystack);
  } catch {
    return haystack.includes(k);
  }
}
