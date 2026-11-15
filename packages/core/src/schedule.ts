// Meal timing from wake time, today's plan for a situation, and progress totals.
import { EATOUT, MEALS, ORDER, SCEN, type EatoutSlot, type MealDef, type MealKey, type ScenId } from './data';
import type { MealEntryRow } from './db';
import { durText, hhmm } from './util';

export interface Schedule {
  b: number; // breakfast
  l: number; // lunch
  s: number; // snack
  d: number; // dinner
  /** Late wake: snack is eaten with the first meal. */
  merge: boolean;
  /** Suggested home workout start, or null when the day is too short. */
  workout: number | null;
}

const r10 = (x: number): number => Math.round(x / 10) * 10;

/** Meal times (minutes) for a wake time. Dinner ends by 19:00-19:30 unless the day is very short. */
export function schedule(wake: number | null): Schedule | null {
  if (wake == null) return null;
  const b = wake + 30;
  const total = 540;
  let d = 19 * 60;
  let span = d - b;
  if (span < total) { d = 19 * 60 + 30; span = d - b; }
  if (span < 90) { d = b + 90; span = 90; }
  const merge = span < 360;
  let k = span / total;
  if (k > 1.35) { k = 1.35; d = b + total * k; }
  let L: number;
  let S: number;
  if (merge) { L = b + span / 2; S = b; } else { L = b + 210 * k; S = L + 180 * k; }
  return { b: r10(b), l: r10(L), s: r10(S), d: r10(d), merge, workout: merge ? null : r10(S + 60) };
}

export interface PlannedMeal extends MealDef {
  key: MealKey;
  /** Clock time in minutes when known. */
  at?: number;
  hint?: string;
}

export interface DayInput {
  scen: ScenId;
  eatout: EatoutSlot;
  wake: number | null;
}

export function plan({ scen, eatout, wake }: DayInput): PlannedMeal[] {
  const s = SCEN[scen];
  const sch = schedule(wake);
  return ORDER.map((k) => {
    let m: PlannedMeal = { key: k, ...MEALS[k] };
    const o = s.over?.[k];
    if (o) m = { ...m, ...o };
    if (scen === 'eatout' && k === eatout) m = { ...m, ...EATOUT(k) };
    if (sch) {
      if (k === 'breakfast') { m.at = sch.b; if (sch.merge) m.hint = '늦게 일어난 날: 간식 닭가슴살을 첫 끼에 같이 먹습니다'; }
      if (k === 'lunch') m.at = sch.l;
      if (k === 'snack') { m.at = sch.s; if (sch.merge) m.time = '첫 끼에 같이'; }
      if (k === 'dinner') m.at = scen === 'lateHome' ? 19 * 60 : sch.d;
      if (k === 'post') {
        if (scen === 'rest') m.at = sch.s;
        else if (scen !== 'lateHome' && sch.workout) m.hint = `추천 홈트 시간 ${hhmm(sch.workout)}쯤`;
      }
    }
    return m;
  });
}

/** Slots that have at least one live entry (eaten as planned or replaced). */
export function eatenSlots(entries: Pick<MealEntryRow, 'slot' | 'kind' | 'deleted_at'>[]): Set<MealKey> {
  const s = new Set<MealKey>();
  for (const e of entries) if (!e.deleted_at && e.slot !== 'extra') s.add(e.slot);
  return s;
}

export interface Summary {
  /** Planned total for the day: entries for logged slots + plan for the rest + extras. */
  total: number;
  totalProtein: number;
  /** Eaten so far. */
  eaten: number;
  eatenProtein: number;
  done: number;
  count: number;
  pct: number;
}

export function summary(p: PlannedMeal[], entries: Pick<MealEntryRow, 'slot' | 'kind' | 'kcal' | 'protein_g' | 'deleted_at'>[]): Summary {
  const live = entries.filter((e) => !e.deleted_at);
  const bySlot = new Map<string, { kcal: number; protein: number }>();
  for (const e of live) {
    const cur = bySlot.get(e.slot) ?? { kcal: 0, protein: 0 };
    cur.kcal += e.kcal;
    cur.protein += e.protein_g;
    bySlot.set(e.slot, cur);
  }
  let total = 0, totalProtein = 0, eaten = 0, eatenProtein = 0, done = 0;
  for (const m of p) {
    const got = bySlot.get(m.key);
    if (got) { total += got.kcal; totalProtein += got.protein; eaten += got.kcal; eatenProtein += got.protein; done++; }
    else { total += m.kcal; totalProtein += m.protein; }
  }
  const extra = bySlot.get('extra');
  if (extra) { total += extra.kcal; totalProtein += extra.protein; eaten += extra.kcal; eatenProtein += extra.protein; }
  return { total, totalProtein, eaten, eatenProtein, done, count: p.length, pct: total ? eaten / total : 0 };
}

export const timeLabel = (m: PlannedMeal): string => (m.at != null ? `${hhmm(m.at)}쯤` : m.time);

export function relText(at: number, nowMin: number): string {
  const diff = at - nowMin;
  if (diff > 10) return `${durText(diff)} 뒤`;
  if (diff >= -60) return '지금 먹을 시간';
  return `${durText(-diff)} 지났어요 · 지금 먹어도 됩니다`;
}

export const DINNER_CUTOFF = 20 * 60;

/** Minutes until the 20:00 dinner cutoff (negative when past). */
export const minutesToCutoff = (nowMin: number): number => DINNER_CUTOFF - nowMin;

/** Plan entry for checking a planned meal as eaten. */
export function planEntry(m: PlannedMeal, date: string, id: string, now: Date): Omit<MealEntryRow, 'updated_at'> {
  return {
    id, date, slot: m.key, kind: 'plan', eaten_at: now.toISOString(), food_id: null,
    name: m.name, servings: null, amount_text: null, items: m.items,
    kcal: m.kcal, protein_g: m.protein, carbs_g: null, fat_g: null, sugar_g: null, sodium_mg: null, fiber_g: null,
    source: 'plan', photo_path: null, confidence: m.est ? 0.6 : 1, note: null, deleted_at: null,
  };
}

/** What to do when a meal is skipped. Keeps the 3-packs-of-chicken rule and the protein floor in view. */
export const SKIP_ADVICE: Record<MealKey, string> = {
  breakfast: '점심에 달걀 2개를 더하거나 간식 닭가슴살을 그대로 먹어 단백질을 채웁니다. 밥 양은 늘리지 않습니다.',
  lunch: '간식 때 큐브와 헬로틴을 같이 먹고 저녁은 그대로 먹습니다. 거른 밥은 다음 끼니로 넘기지 않습니다.',
  snack: '닭가슴살 1팩을 저녁에 더해 하루 3팩을 지킵니다. 견과는 건너뛰어도 됩니다.',
  post: '프로틴은 저녁 전에 물에 타서 마십니다. 운동을 쉬었다면 건너뛰어도 됩니다.',
  dinner: '8시 전이면 프로틴 1스쿱이라도 마십니다. 굶고 자면 다음 날 폭식하기 쉽습니다.',
};

/** Protein left on the table after skipping, against the daily floor. */
export function proteinGap(totalProtein: number, floor: number): number {
  return Math.max(0, Math.round(floor - totalProtein));
}
