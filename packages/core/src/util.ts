// Date and number helpers shared by web, app and server.
// Dates are local calendar days written as 'YYYY-MM-DD'; minutes are minutes since local midnight.

export const DOW = ['일', '월', '화', '수', '목', '금', '토'] as const;

export const pad = (n: number): string => String(n).padStart(2, '0');

export const fmt = (n: number): string => Number(n).toLocaleString('ko-KR');

export const keyOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const parseKey = (k: string): Date => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
};

export const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Whole calendar days from a to b (DST-safe). */
export const daysBetween = (a: Date, b: Date): number =>
  Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);

export const md = (d: Date): string => `${d.getMonth() + 1}/${d.getDate()}`;
export const mdw = (d: Date): string => `${md(d)} (${DOW[d.getDay()]})`;
export const dateLabel = (d: Date): string => `${d.getMonth() + 1}월 ${d.getDate()}일 ${DOW[d.getDay()]}요일`;

export const minutesOf = (d: Date): number => d.getHours() * 60 + d.getMinutes();

export const hhmm = (m: number): string => {
  const r = Math.round(m);
  return `${pad(Math.floor(r / 60) % 24)}:${pad(((r % 60) + 60) % 60)}`;
};

export const durText = (m: number): string => {
  const r = Math.max(0, Math.round(m));
  const h = Math.floor(r / 60);
  const mm = r % 60;
  return h ? `${h}시간${mm ? ` ${mm}분` : ''}` : `${mm}분`;
};

/** Signed one-decimal string; -0.04 becomes '0.0'. */
export const sgn = (x: number): string => {
  const r = Math.round(x * 10) / 10;
  return r === 0 ? '0.0' : `${r > 0 ? '+' : ''}${r.toFixed(1)}`;
};

export const round1 = (x: number): number => Math.round(x * 10) / 10;

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
