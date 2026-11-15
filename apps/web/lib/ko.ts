// Korean object particle (을/를) for names that end in Hangul, Latin letters or digits ("홈트 B를", "간식을").
const LATIN_FINAL = new Set(['L', 'M', 'N', 'R']); // 엘, 엠, 엔, 알
const DIGIT_FINAL = new Set(['0', '1', '3', '6', '7', '8']); // 영, 일, 삼, 육, 칠, 팔

export function eul(word: string): string {
  const ch = word.trim().replace(/\s*\(.*\)$/, '').slice(-1);
  const code = ch.charCodeAt(0);
  let batchim: boolean;
  if (code >= 0xac00 && code <= 0xd7a3) batchim = (code - 0xac00) % 28 !== 0;
  else if (/[a-z]/i.test(ch)) batchim = LATIN_FINAL.has(ch.toUpperCase());
  else if (/\d/.test(ch)) batchim = DIGIT_FINAL.has(ch);
  else batchim = false;
  return `${word}${batchim ? '을' : '를'}`;
}
