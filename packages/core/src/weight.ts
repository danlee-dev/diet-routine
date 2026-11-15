// Weight series, smoothed trend and projection.
import type { WeightRow } from './db';
import { programKey, type Program } from './program';
import { round1 } from './util';

export interface WeightPoint {
  /** program day index */
  i: number;
  w: number;
}

const valid = (kg: unknown): kg is number => typeof kg === 'number' && kg > 30 && kg < 200;

/** Points from program day 0 up to `uptoIdx` (inclusive) that have a weight. */
export function weightSeries(program: Program, weights: Pick<WeightRow, 'date' | 'kg' | 'deleted_at'>[], uptoIdx: number): WeightPoint[] {
  const byDate = new Map<string, number>();
  for (const r of weights) if (!r.deleted_at && valid(r.kg)) byDate.set(r.date, r.kg);
  const out: WeightPoint[] = [];
  const last = Math.min(program.days - 1, Math.max(0, uptoIdx));
  for (let i = 0; i <= last; i++) {
    const w = byDate.get(programKey(program, i));
    if (w != null) out.push({ i, w });
  }
  return out;
}

/** Trailing 7-day mean at each point. */
export const rolling7 = (data: WeightPoint[]): WeightPoint[] =>
  data.map((p) => {
    const win = data.filter((q) => q.i <= p.i && q.i > p.i - 7);
    return { i: p.i, w: win.reduce((a, q) => a + q.w, 0) / win.length };
  });

/** Exponentially smoothed trend (alpha 0.1 per day, gaps decay accordingly). */
export function trend(data: WeightPoint[], alpha = 0.1): WeightPoint[] {
  const out: WeightPoint[] = [];
  let t: number | null = null;
  let prevI = 0;
  for (const p of data) {
    if (t == null) t = p.w;
    else {
      const a = 1 - Math.pow(1 - alpha, Math.max(1, p.i - prevI));
      t = t + a * (p.w - t);
    }
    prevI = p.i;
    out.push({ i: p.i, w: t });
  }
  return out;
}

export interface WeightStats {
  last: number | null;
  count: number;
  /** Linear-regression projection for the last program day (needs 5+ points). */
  projection: number | null;
  /** kg per week from regression, negative = losing. */
  ratePerWeek: number | null;
}

export function weightStats(program: Program, data: WeightPoint[]): WeightStats {
  const last = data.length ? data[data.length - 1]!.w : null;
  if (data.length < 5) return { last, count: data.length, projection: null, ratePerWeek: null };
  const n = data.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of data) { sx += p.i; sy += p.w; sxx += p.i * p.i; sxy += p.i * p.w; }
  const den = n * sxx - sx * sx;
  if (den === 0) return { last, count: n, projection: null, ratePerWeek: null };
  const b = (n * sxy - sx * sy) / den;
  const a = (sy - b * sx) / n;
  return { last, count: n, projection: round1(a + b * (program.days - 1)), ratePerWeek: round1(b * 7) };
}

/** Most recent weight strictly before program day `i` (looks back up to 60 days). */
export function previousWeight(program: Program, weights: Pick<WeightRow, 'date' | 'kg' | 'deleted_at'>[], i: number): number | null {
  const byDate = new Map<string, number>();
  for (const r of weights) if (!r.deleted_at && valid(r.kg)) byDate.set(r.date, r.kg);
  for (let j = i - 1; j >= Math.max(i - 60, -60); j--) {
    const w = byDate.get(programKey(program, j));
    if (w != null) return w;
  }
  return null;
}
