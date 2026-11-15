// "이번 주 어땠어?": a summary of recent days from per-day stats the device computes (packages/data
// coachHistory). Pure, so the server tool and the tests use the same rules, and every number the coach
// says about a week comes from here.
import { addDays, keyOf, parseKey, round1 } from '../util';

/** One day as the records screens see it. */
export interface DayStat {
  date: string;
  /** meals in that day's plan, logged slots (eaten, replaced or skipped), skipped slots */
  planned: number;
  logged: number;
  skipped: number;
  /** what was logged, and the day's target after adjustments and run credit */
  kcal: number;
  protein: number;
  target: number;
  steps: number;
  water: number;
  /** the day's weigh-in and the smoothed trend on that day (null before the first weigh-in) */
  weight: number | null;
  trend: number | null;
  workout: 'home_a' | 'home_b' | null;
  workoutMin: number | null;
  runs: number;
  runKm: number;
  runMin: number;
}

export type TrendRange = 'this_week' | 'last_week' | 'last_7' | 'last_14';

export const TREND_RANGE_LABEL: Record<TrendRange, string> = { this_week: '이번 주', last_week: '지난주', last_7: '최근 7일', last_14: '최근 14일' };

/** A day counts as kept when most of its meals were logged and it ended within 100 kcal of the target. */
export const KEPT_MARGIN = 100;
export const isKept = (d: Pick<DayStat, 'planned' | 'logged' | 'kcal' | 'target'>): boolean =>
  d.logged >= Math.min(4, Math.max(1, d.planned)) && d.kcal <= d.target + KEPT_MARGIN;

/** First and last date of a range ending on `today` (weeks start on Monday). */
export function trendDates(range: TrendRange, today: string): { from: string; to: string } {
  const t = parseKey(today);
  const mondayOffset = (t.getDay() + 6) % 7;
  switch (range) {
    case 'this_week': return { from: keyOf(addDays(t, -mondayOffset)), to: today };
    case 'last_week': return { from: keyOf(addDays(t, -mondayOffset - 7)), to: keyOf(addDays(t, -mondayOffset - 1)) };
    case 'last_7': return { from: keyOf(addDays(t, -6)), to: today };
    case 'last_14': return { from: keyOf(addDays(t, -13)), to: today };
  }
}

export interface TrendSummary {
  range: TrendRange;
  label: string;
  from: string;
  to: string;
  /** calendar days in the range, and the finished ones (today counts once all its meals are logged) */
  days: number;
  finished: number;
  kept: { days: number; of: number; dates: string[] };
  intake: { loggedDays: number; avgKcal: number | null; avgTarget: number | null; avgProtein: number | null; proteinFloor: number; proteinDays: number };
  weight: {
    first: { date: string; kg: number } | null;
    last: { date: string; kg: number } | null;
    /** last minus first weigh-in, and the trend's change over the same days */
    change: number | null;
    trendFirst: number | null;
    trendLast: number | null;
    trendChange: number | null;
    /** whole-program regression rate (snapshot), kg per week */
    ratePerWeek: number | null;
    points: { date: string; kg: number | null; trend: number | null }[];
  };
  workouts: { home: number; minutes: number; dates: string[] };
  runs: { count: number; km: number; minutes: number };
  steps: { avg: number | null; goal: number; daysAtGoal: number };
  /** the largest day over target in the range, if any */
  biggestOver: { date: string; over: number } | null;
}

export function summarizeTrends(
  history: readonly DayStat[], range: TrendRange, today: string,
  opts: { proteinFloor: number; stepsGoal: number; ratePerWeek: number | null },
): TrendSummary {
  const { from, to } = trendDates(range, today);
  const byDate = new Map(history.map((d) => [d.date, d]));
  const dates: string[] = [];
  for (let d = parseKey(from); keyOf(d) <= to; d = addDays(d, 1)) dates.push(keyOf(d));
  const inRange = dates.map((k) => byDate.get(k)).filter((d): d is DayStat => !!d);
  // today is still going: it counts only once every planned meal is logged
  const finishedDays = inRange.filter((d) => d.date < today || (d.planned > 0 && d.logged >= d.planned));
  const kept = finishedDays.filter(isKept);
  const logged = finishedDays.filter((d) => d.logged > 0);
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

  const weighed = inRange.filter((d) => d.weight != null);
  const trended = inRange.filter((d) => d.trend != null);
  const first = weighed[0], last = weighed[weighed.length - 1];
  const tFirst = trended[0]?.trend ?? null, tLast = trended[trended.length - 1]?.trend ?? null;

  const home = inRange.filter((d) => d.workout);
  const stepDays = finishedDays.filter((d) => d.steps > 0);
  const over = finishedDays.map((d) => ({ date: d.date, over: Math.round(d.kcal - d.target) })).filter((x) => x.over > KEPT_MARGIN).sort((a, b) => b.over - a.over)[0] ?? null;

  return {
    range, label: TREND_RANGE_LABEL[range], from, to,
    days: dates.length,
    finished: finishedDays.length,
    kept: { days: kept.length, of: finishedDays.length, dates: kept.map((d) => d.date) },
    intake: {
      loggedDays: logged.length,
      avgKcal: avg(logged.map((d) => d.kcal)),
      avgTarget: avg(logged.map((d) => d.target)),
      avgProtein: avg(logged.map((d) => d.protein)),
      proteinFloor: opts.proteinFloor,
      proteinDays: logged.filter((d) => d.protein >= opts.proteinFloor).length,
    },
    weight: {
      first: first ? { date: first.date, kg: first.weight! } : null,
      last: last ? { date: last.date, kg: last.weight! } : null,
      change: first && last && first !== last ? round1(last.weight! - first.weight!) : null,
      trendFirst: tFirst != null ? round1(tFirst) : null,
      trendLast: tLast != null ? round1(tLast) : null,
      trendChange: tFirst != null && tLast != null && trended.length > 1 ? round1(tLast - tFirst) : null,
      ratePerWeek: opts.ratePerWeek,
      points: dates.map((k) => { const d = byDate.get(k); return { date: k, kg: d?.weight ?? null, trend: d?.trend != null ? round1(d.trend) : null }; }),
    },
    workouts: { home: home.length, minutes: Math.round(home.reduce((s, d) => s + (d.workoutMin ?? 0), 0)), dates: home.map((d) => d.date) },
    runs: {
      count: inRange.reduce((s, d) => s + d.runs, 0),
      km: round1(inRange.reduce((s, d) => s + d.runKm, 0)),
      minutes: Math.round(inRange.reduce((s, d) => s + d.runMin, 0)),
    },
    steps: { avg: avg(stepDays.map((d) => d.steps)), goal: opts.stepsGoal, daysAtGoal: stepDays.filter((d) => d.steps >= opts.stepsGoal).length },
    biggestOver: over,
  };
}
