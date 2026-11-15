// Insights computed from the record: weight trend and arrival date, "water weight" after a salty day,
// real maintenance and an adaptive daily target, meals that keep getting skipped, the morning-after
// carry-over, and the weekly recap. Pure: the data layer gathers the rows, the screens and the reminder
// planner only print what these return.
import { ORDER, type MealKey, type PlanItem, type ScenId } from './data';
import type { MealEntryRow } from './db';
import { carryDays, type AdjustedMeal, type MealOverride, type PlanOverride } from './rebalance';
import { MIN_KCAL, type Sex } from './targets';
import { addDays, DOW, fmt, keyOf, md, parseKey, round1 } from './util';

export const KCAL_PER_KG = 7700;

const dayNo = (key: string): number => Math.round(parseKey(key).getTime() / 86400_000);
const round10 = (n: number): number => Math.round(n / 10) * 10;
/** Signed one-decimal kg with a real minus sign ("−0.6", "+0.3", "0.0"). */
export const signedKg = (x: number): string => {
  const r = round1(x);
  return r === 0 ? '0.0' : `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}`;
};

/** Korean object particle (을/를) after a word ending in Hangul, Latin or a digit. */
export function eul(word: string): string {
  const ch = word.trim().replace(/\s*\(.*\)$/, '').slice(-1);
  const code = ch.charCodeAt(0);
  let batchim = false;
  if (code >= 0xac00 && code <= 0xd7a3) batchim = (code - 0xac00) % 28 !== 0;
  else if (/[a-z]/i.test(ch)) batchim = 'LMNR'.includes(ch.toUpperCase());
  else if (/\d/.test(ch)) batchim = '013678'.includes(ch);
  return `${word}${batchim ? '을' : '를'}`;
}

// ---------------- weight trend ----------------
export interface DatedWeight {
  key: string;
  kg: number;
}

/**
 * Exponentially smoothed trend by date (alpha 0.1 per day; a gap of n days decays like n steps).
 * Same rule as `trend` in weight.ts, keyed by date so it works across program boundaries.
 */
export function trendByDate(weights: readonly DatedWeight[], alpha = 0.1): DatedWeight[] {
  const sorted = [...weights].sort((a, b) => a.key.localeCompare(b.key));
  const out: DatedWeight[] = [];
  let t: number | null = null;
  let prev = 0;
  for (const w of sorted) {
    const n = dayNo(w.key);
    if (t == null) t = w.kg;
    else t += (1 - Math.pow(1 - alpha, Math.max(1, n - prev))) * (w.kg - t);
    prev = n;
    out.push({ key: w.key, kg: t });
  }
  return out;
}

/** The trend value on a date: the last smoothed value at or before it. */
export function trendOn(trend: readonly DatedWeight[], key: string): number | null {
  let v: number | null = null;
  for (const p of trend) { if (p.key <= key) v = p.kg; else break; }
  return v;
}

/** Least-squares slope in kg per day over points (x = day number). */
function slope(points: readonly DatedWeight[]): number | null {
  if (points.length < 2) return null;
  const xs = points.map((p) => dayNo(p.key));
  const n = points.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = points.reduce((a, p) => a + p.kg, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i]! - mx) * (points[i]!.kg - my); den += (xs[i]! - mx) ** 2; }
  return den === 0 ? null : num / den;
}

/** Weight rate over the last `window` days (kg per day), from the daily weights. Needs 5+ points over 7+ days. */
export function recentRate(weights: readonly DatedWeight[], window = 21): number | null {
  if (!weights.length) return null;
  const sorted = [...weights].sort((a, b) => a.key.localeCompare(b.key));
  const last = dayNo(sorted[sorted.length - 1]!.key);
  const pts = sorted.filter((w) => dayNo(w.key) > last - window);
  if (pts.length < 5 || last - dayNo(pts[0]!.key) < 7) return null;
  return slope(pts);
}

export type Arrival =
  | { kind: 'reached'; trend: number }
  | { kind: 'eta'; date: string; days: number; ratePerWeek: number; trend: number }
  | { kind: 'flat'; ratePerWeek: number; trend: number }
  | { kind: 'unknown' };

/** When the trend reaches `goal` at the current rate. Stops looking past a year. */
export function goalArrival(weights: readonly DatedWeight[], goal: number): Arrival {
  const tr = trendByDate(weights);
  const last = tr[tr.length - 1];
  if (!last) return { kind: 'unknown' };
  if (last.kg <= goal + 0.05) return { kind: 'reached', trend: round1(last.kg) };
  const rate = recentRate(weights);
  if (rate == null) return { kind: 'unknown' };
  const ratePerWeek = round1(rate * 7);
  if (rate > -0.01) return { kind: 'flat', ratePerWeek, trend: round1(last.kg) };
  const days = Math.ceil((last.kg - goal) / -rate);
  if (days > 365) return { kind: 'flat', ratePerWeek, trend: round1(last.kg) };
  return { kind: 'eta', date: keyOf(addDays(parseKey(last.key), days)), days, ratePerWeek, trend: round1(last.kg) };
}

/** One line for the records screen. */
export function arrivalText(a: Arrival, goal: number): string | null {
  switch (a.kind) {
    case 'reached': return `추세가 목표 ${goal.toFixed(1)}kg에 닿았습니다`;
    case 'eta': {
      const d = parseKey(a.date);
      return `지금 추세면 ${goal.toFixed(1)}kg에 ${md(d)} (${DOW[d.getDay()]})쯤 닿습니다 · 주 ${Math.abs(a.ratePerWeek).toFixed(1)}kg`;
    }
    case 'flat': return a.ratePerWeek > 0
      ? `최근 3주 추세가 주 ${a.ratePerWeek.toFixed(1)}kg 오르고 있어 도착일을 정할 수 없습니다`
      : `최근 3주 추세가 거의 그대로라 도착일을 정할 수 없습니다`;
    case 'unknown': return null;
  }
}

// ---------------- water weight after a salty day ----------------
const SALTY = /치킨|짜장|짬뽕|마라|떡볶이|버거|피자|삼겹|국밥|찌개|전골|탕|라면|냉면|우동|국수|도시락|김밥|족발|보쌈|곱창|순대|부대|돈가스|회식|소주|맥주|하이볼|막걸리|와인|술|외식/;

/** A day that leaves water weight the next morning: lots of sodium, or eating out (by name or situation). */
export function saltyDay(
  entries: readonly Pick<MealEntryRow, 'kind' | 'name' | 'sodium_mg' | 'deleted_at'>[], scen?: ScenId | null,
): { names: string[] } | null {
  const live = entries.filter((e) => !e.deleted_at && e.kind !== 'skip');
  const sodium = live.reduce((s, e) => s + (e.sodium_mg ?? 0), 0);
  const named = live.filter((e) => (e.kind === 'replace' || e.kind === 'extra') && SALTY.test(e.name)).map((e) => e.name.replace(/\s*\(.*\)$/, ''));
  if (named.length) return { names: [...new Set(named)].slice(0, 2) };
  if (sodium >= 3000) {
    const top = live.filter((e) => (e.sodium_mg ?? 0) > 0).sort((a, b) => (b.sodium_mg ?? 0) - (a.sodium_mg ?? 0));
    return { names: top.slice(0, 2).map((e) => e.name) };
  }
  if (scen === 'eatout') return { names: ['외식'] };
  return null;
}

export interface WaterNote {
  /** today minus the previous weigh-in */
  jump: number;
  names: string[];
  /** the smoothed trend, which barely moves */
  trend: number;
}

/** Today's weight jumped 0.4 kg or more after a salty day: say it is water, not fat. */
export function waterWeightNote(today: number | null, prev: number | null, salty: { names: string[] } | null, trend: number | null): WaterNote | null {
  if (today == null || prev == null || !salty || trend == null) return null;
  const jump = round1(today - prev);
  if (jump < 0.4) return null;
  return { jump, names: salty.names, trend: round1(trend) };
}

export function waterNoteText(n: WaterNote): { title: string; body: string } {
  const what = n.names.join(', ');
  return {
    title: '외식 다음 날의 물 무게입니다',
    body: `${what === '외식' ? '어제 외식' : `어제 먹은 ${what}`} 때문에 소금이 많아 물이 ${n.jump.toFixed(1)}kg 붙었습니다. 2~3일이면 빠지고, 추세는 ${n.trend.toFixed(1)}kg 그대로입니다.`,
  };
}

// ---------------- maintenance and adaptive target ----------------
export interface IntakeDay {
  key: string;
  kcal: number;
  /** every planned slot was logged (eaten, changed or skipped), so the total can be trusted */
  complete: boolean;
}

export interface MaintenanceEstimate {
  kcal: number;
  /** complete intake days used */
  days: number;
  intake: number;
  /** weight change over the same days, kg per week (negative = losing) */
  ratePerWeek: number;
}

/**
 * Real maintenance from the record: average intake plus the energy the weight change stands for.
 * Uses complete days in the last 21; needs `minDays` of them and 5+ weigh-ins spanning 10+ days.
 */
export function estimateMaintenance(intake: readonly IntakeDay[], weights: readonly DatedWeight[], minDays = 10): MaintenanceEstimate | null {
  const days = [...intake].filter((d) => d.complete).sort((a, b) => a.key.localeCompare(b.key));
  if (!days.length) return null;
  const end = days[days.length - 1]!.key;
  const used = days.filter((d) => dayNo(d.key) > dayNo(end) - 21);
  if (used.length < minDays) return null;
  const from = used[0]!.key;
  const ws = weights.filter((w) => w.key >= from && w.key <= end);
  if (ws.length < 5 || dayNo(ws[ws.length - 1]!.key) - dayNo(ws[0]!.key) < 10) return null;
  const rate = slope([...ws].sort((a, b) => a.key.localeCompare(b.key)));
  if (rate == null) return null;
  const avg = used.reduce((s, d) => s + d.kcal, 0) / used.length;
  const kcal = round10(avg - rate * KCAL_PER_KG);
  if (kcal < 1200 || kcal > 4500) return null;
  return { kcal, days: used.length, intake: round10(avg), ratePerWeek: round1(rate * 7) };
}

/** kg per week a daily target loses at a given maintenance. */
export const paceAt = (maintenance: number, target: number): number => round1(((maintenance - target) * 7) / KCAL_PER_KG);

export interface TargetProposal {
  current: number;
  next: number;
  maintenance: number;
  /** kg per week now and after the change */
  pace: number;
  nextPace: number;
  days: number;
}

export const PACE_MIN = 0.7;
export const PACE_MAX = 1.0;

/**
 * A new daily target when the current one loses slower than 0.7 or faster than 1.0 kg a week. Moves at most
 * 300 kcal at a time, never below the sex minimum (1,500 when unknown; or the current target, if already lower), and
 * stays quiet for changes under 50 kcal.
 */
export function adaptiveTarget(est: MaintenanceEstimate, current: number, sex?: Sex | null): TargetProposal | null {
  const pace = ((est.kcal - current) * 7) / KCAL_PER_KG;
  if (pace >= PACE_MIN && pace <= PACE_MAX) return null;
  const aim = pace < PACE_MIN ? PACE_MIN + 0.05 : PACE_MAX - 0.05;
  let next = round10(est.kcal - (aim * KCAL_PER_KG) / 7);
  // unknown sex: the higher floor, the cautious side for a cut
  const floor = Math.min(MIN_KCAL[sex ?? 'male'], current);
  next = Math.max(next, floor);
  next = Math.min(current + 300, Math.max(current - 300, next));
  if (Math.abs(next - current) < 50) return null;
  return { current, next, maintenance: est.kcal, pace: round1(pace), nextPace: paceAt(est.kcal, next), days: est.days };
}

export function adaptiveText(p: TargetProposal): { title: string; body: string } {
  const now = p.pace <= 0
    ? '지금 목표로는 체중이 줄지 않습니다'
    : p.pace < PACE_MIN ? `지금 목표로는 주 ${p.pace.toFixed(1)}kg씩 빠져 느립니다` : `지금 목표로는 주 ${p.pace.toFixed(1)}kg씩 빠져 너무 빠릅니다`;
  return {
    title: `하루 목표를 ${fmt(p.next)}kcal로 바꿀까요?`,
    body: `지난 ${p.days}일 기록으로 본 실제 유지 칼로리는 약 ${fmt(p.maintenance)}kcal입니다. ${now}. ${fmt(p.next)}kcal로 바꾸면 주 ${p.nextPace.toFixed(1)}kg 속도가 됩니다.`,
  };
}

// ---------------- meals that keep getting skipped ----------------
export interface SlotDay {
  key: string;
  dow: number;
  /** slots in that day's plan */
  planned: MealKey[];
  /** how each logged slot was logged */
  slots: Partial<Record<MealKey, 'skip' | 'eaten'>>;
}

export interface SkipPattern {
  slot: MealKey;
  /** the meal that takes over the skipped meal's food */
  into: MealKey;
  /** skipped on weekdays only */
  weekdays: boolean;
  skips: number;
}

const isWeekday = (dow: number): boolean => dow >= 1 && dow <= 5;
/** "운동 후" follows the workout, so it is never the meal to drop or to grow. */
const MOVABLE: MealKey[] = ORDER.filter((k) => k !== 'post');

/**
 * The meal skipped on purpose most often in the given days (the data layer passes the last two weeks): at least
 * four skips and half of the days it was logged. Weekday-only when weekends were eaten as planned.
 */
export function skipPattern(days: readonly SlotDay[]): SkipPattern | null {
  let best: SkipPattern | null = null;
  for (const slot of MOVABLE) {
    let skips = 0, logged = 0, wdSkips = 0, wdLogged = 0, weSkips = 0, weLogged = 0;
    const plannedInto = new Set<MealKey>();
    for (const d of days) {
      if (!d.planned.includes(slot)) continue;
      for (const k of d.planned) plannedInto.add(k);
      const s = d.slots[slot];
      if (!s) continue;
      logged++;
      if (isWeekday(d.dow)) wdLogged++; else weLogged++;
      if (s === 'skip') { skips++; if (isWeekday(d.dow)) wdSkips++; else weSkips++; }
    }
    if (skips < 4 || skips / logged < 0.5) continue;
    const i = MOVABLE.indexOf(slot);
    const into = MOVABLE.slice(i + 1).find((k) => plannedInto.has(k)) ?? MOVABLE.slice(0, i).reverse().find((k) => plannedInto.has(k));
    if (!into) continue;
    const weekdays = wdSkips >= 4 && wdSkips / wdLogged >= 0.6 && weLogged >= 1 && weSkips / weLogged <= 0.34;
    if (!best || skips > best.skips) best = { slot, into, weekdays, skips };
  }
  return best;
}

/** "1팩" + "1팩" = "2팩"; anything else is listed twice. */
function mergeItems(a: readonly PlanItem[], b: readonly PlanItem[]): PlanItem[] {
  const out = a.map((x) => ({ ...x }));
  for (const x of b) {
    if (x.kcal === 0) continue; // "블랙커피 마시고 싶으면"
    const same = out.find((y) => y.name === x.name);
    const m1 = same?.amount.match(/^(\d+)(\D+)$/);
    const m2 = x.amount.match(/^(\d+)(\D+)$/);
    if (same && m1 && m2 && m1[2] === m2[2]) {
      same.amount = `${Number(m1[1]) + Number(m2[1])}${m1[2]}`;
      if (same.kcal != null && x.kcal != null) same.kcal += x.kcal;
      if (same.protein != null && x.protein != null) same.protein += x.protein;
    } else out.push({ ...x });
  }
  return out;
}

export const WEEKDAYS = [1, 2, 3, 4, 5];

export interface SkipChange {
  override: PlanOverride;
  from: AdjustedMeal;
  to: AdjustedMeal;
  weekdays: boolean;
}

/**
 * The plan version that drops the skipped meal and moves its food into the next one, so the day's total and
 * protein stay the same. Weekday-only needs both meals free of other edits (a meal holds one change at a time).
 */
export function skipPlanChange(p: SkipPattern, meals: readonly AdjustedMeal[], override: PlanOverride | null): SkipChange | null {
  const from = meals.find((m) => m.key === p.slot);
  const to = meals.find((m) => m.key === p.into);
  if (!from || !to) return null;
  const weekdays = p.weekdays && !override?.meals?.[p.slot] && !override?.meals?.[p.into];
  const dows = weekdays ? { dows: WEEKDAYS } : {};
  const fromName = from.name.replace(/\s*\(.*\)$/, '');
  const drop: MealOverride = { removed: true, ...dows, note: `${weekdays ? '평일에 ' : ''}자주 건너뛰어 뺐습니다` };
  const grow: MealOverride = {
    ...override?.meals?.[p.into], items: mergeItems(to.items, from.items), kcal: to.kcal + from.kcal, protein: to.protein + from.protein,
    ...dows, note: `${fromName} 몫을 더했습니다`,
  };
  return { override: { ...override, meals: { ...override?.meals, [p.slot]: drop, [p.into]: grow } }, from, to, weekdays };
}

export function skipText(p: SkipPattern, c: SkipChange): { title: string; body: string } {
  const f = c.from.name.replace(/\s*\(.*\)$/, '');
  const t = c.to.name.replace(/\s*\(.*\)$/, '');
  return {
    title: `${c.weekdays ? '평일 ' : ''}${f} 빼고 ${t} 늘릴까요?`,
    body: `최근 2주 동안 ${eul(f)} ${p.skips}번 건너뛰었습니다. ${t}에 ${f} 몫 ${fmt(c.from.kcal)}kcal, 단백질 ${c.from.protein}g을 더해 하루 합계는 그대로입니다.`,
  };
}

// ---------------- the morning after a big overshoot ----------------
/** Yesterday ran over by this much; worth a morning note from here. */
export const BIG_OVER = 300;

export interface Overshoot {
  /** kcal over yesterday's target */
  over: number;
  /** per-day cuts from today (applied rows, or the plan that "나누기" would write) */
  carry: { offset: number; kcal: number }[];
  /** the cuts are already in the plan */
  applied: boolean;
  /** very large overshoot: walk more instead of cutting further */
  stepsBonus: number;
}

export function overshootFor(over: number, target: number, applied: { offset: number; kcal: number }[] = []): Overshoot | null {
  if (over < BIG_OVER && !applied.length) return null;
  if (applied.length) return { over: Math.max(0, round10(over)), carry: applied, applied: true, stepsBonus: 0 };
  const carry = carryDays(over, target, 0);
  const spread = carry.reduce((s, c) => s + c.kcal, 0);
  return { over: round10(over), carry, applied: false, stepsBonus: over - spread > 600 ? 3000 : 0 };
}

export function overshootText(o: Overshoot): { title: string; body: string } {
  const n = o.carry.length;
  const same = n > 0 && o.carry.every((c) => c.kcal === o.carry[0]!.kcal);
  const split = n === 0 ? '' : same ? `${n}일 동안 하루 ${fmt(o.carry[0]!.kcal)}kcal씩` : `${n}일 동안 ${o.carry.map((c) => fmt(c.kcal)).join('·')}kcal`;
  const title = o.over > 0 ? `어제 목표보다 ${fmt(o.over)}kcal 많았습니다` : '어제 넘친 만큼 나눠 줄입니다';
  const steps = o.stepsBonus ? ` 나머지는 걸음 ${fmt(o.stepsBonus)}보를 더 걸어 채웁니다.` : '';
  if (o.applied) return { title, body: `오늘부터 ${split} 덜 먹어 나눠 갚습니다. 한 번에 굶지 않아도 됩니다.` };
  if (!n) return { title, body: `오늘 목표가 이미 낮아 더 줄이지 않습니다. 걸음을 ${fmt(3000)}보 더 걸어 채웁니다.` };
  return { title, body: `오늘부터 ${split} 줄이면 맞춰집니다.${steps} 한 번에 굶지 않아도 됩니다.` };
}

// ---------------- weekly recap ----------------
export interface RecapDay {
  key: string;
  eaten: number;
  target: number;
  complete: boolean;
  /** meals eaten (not skipped) */
  meals: number;
  workout: boolean;
  runs: { kind: 'run' | 'walk'; km: number }[];
  steps: number;
  stepsGoal: number;
}

export interface WeeklyRecap {
  from: string;
  to: string;
  /** days of the range up to today */
  days: number;
  kept: number;
  best: { key: string; eaten: number; target: number; notes: string[] } | null;
  trend: { start: number | null; end: number | null; delta: number | null };
  workouts: number;
  runs: number;
  runKm: number;
  walks: number;
  walkKm: number;
  avgEaten: number | null;
}

/** Monday to Sunday of this week; early in the week (Monday, Tuesday) the week before. */
export function recapRange(today: string): { from: string; to: string } {
  const d = parseKey(today);
  const back = (d.getDay() + 6) % 7; // days since Monday
  const mon = addDays(d, back <= 1 ? -back - 7 : -back);
  return { from: keyOf(mon), to: keyOf(addDays(mon, 6)) };
}

/** A day counts as kept when every meal was logged and the total stayed within 100 kcal of the target. */
export const keptDay = (d: Pick<RecapDay, 'complete' | 'eaten' | 'target'>): boolean => d.complete && d.eaten <= d.target + 100;

export function weeklyRecap(days: readonly RecapDay[], range: { from: string; to: string }, today: string, weights: readonly DatedWeight[]): WeeklyRecap {
  const inRange = days.filter((d) => d.key >= range.from && d.key <= range.to && d.key <= today);
  const kept = inRange.filter(keptDay);
  const complete = inRange.filter((d) => d.complete);
  const score = (d: RecapDay) =>
    (keptDay(d) ? 100 : 0) + (d.workout ? 10 : 0) + (d.runs.length ? 10 : 0) + (d.steps >= d.stepsGoal ? 10 : 0) - Math.abs(d.eaten - d.target) / 100;
  const top = [...complete].sort((a, b) => score(b) - score(a) || a.key.localeCompare(b.key))[0];
  const best = top ? {
    key: top.key, eaten: top.eaten, target: top.target,
    notes: [
      `${fmt(top.eaten)}kcal`,
      ...(top.workout ? ['홈트'] : []),
      ...top.runs.filter((r) => r.kind === 'run').map((r) => `${r.km.toFixed(1)}km 달리기`),
      ...(top.steps >= top.stepsGoal ? [`${fmt(top.steps)}보`] : []),
    ],
  } : null;
  const tr = trendByDate(weights);
  const end = trendOn(tr, range.to < today ? range.to : today);
  const before = trendOn(tr, keyOf(addDays(parseKey(range.from), -1)));
  const firstIn = tr.find((p) => p.key >= range.from && p.key <= range.to)?.kg ?? null;
  const start = before ?? firstIn;
  const runs = inRange.flatMap((d) => d.runs);
  const km = (k: 'run' | 'walk') => round1(runs.filter((r) => r.kind === k).reduce((s, r) => s + r.km, 0));
  return {
    from: range.from, to: range.to, days: inRange.length, kept: kept.length, best,
    trend: { start: start != null ? round1(start) : null, end: end != null ? round1(end) : null, delta: start != null && end != null ? round1(end - start) : null },
    workouts: inRange.filter((d) => d.workout).length,
    runs: runs.filter((r) => r.kind === 'run').length, runKm: km('run'),
    walks: runs.filter((r) => r.kind === 'walk').length, walkKm: km('walk'),
    avgEaten: complete.length ? Math.round(complete.reduce((s, d) => s + d.eaten, 0) / complete.length) : null,
  };
}

/** The Sunday 20:00 notification. */
export function weeklyReportText(r: WeeklyRecap, nextGoal: string | null): { title: string; body: string } {
  const parts: string[] = [];
  if (r.trend.end != null) parts.push(`추세 ${r.trend.end.toFixed(1)}kg${r.trend.delta != null ? ` (${signedKg(r.trend.delta)})` : ''}`);
  parts.push(`지킨 날 ${r.kept}/${r.days}일`);
  if (r.workouts) parts.push(`홈트 ${r.workouts}회`);
  if (r.runs) parts.push(`달리기 ${r.runKm.toFixed(1)}km`);
  return { title: '이번 주 리포트', body: `${parts.join(' · ')}.${nextGoal ? ` 다음 주 목표는 ${nextGoal}입니다.` : ''}` };
}
