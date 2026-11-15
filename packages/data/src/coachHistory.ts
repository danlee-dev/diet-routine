// Per-day stats of recent days for the coach's get_trends (summarized by summarizeTrends in core).
// Same functions the screens use: the day's meals after plan versions and adjustments, deduped entries,
// the target after adjustments and run credit, and the weight trend of the records chart.
import { addDays, adjustedTarget, keyOf, summary, trendByDate, type MealKey, type WeightRow } from '@diet/core';
import type { DayStat } from '@diet/core/coach';
import { dayRow, entriesFor, mealsFor, weightOn, workoutOn, type Env } from './model';
import { adjustmentsFor } from './plan';
import { runCredit, runsOn } from './runCredit';

/** Smoothed weight on each weigh-in day up to today: the same trend the records chart draws (weightData). */
function trendMap(env: Env): Map<string, number> {
  const today = keyOf(env.now());
  const rows = env.store.all<WeightRow>('weights').filter((r) => !r.deleted_at && r.kg > 30 && r.kg < 250 && r.date <= today);
  return new Map(trendByDate(rows.map((r) => ({ key: r.date, kg: r.kg }))).map((p) => [p.key, p.kg]));
}

export function dayStat(env: Env, date: string, trends: Map<string, number> = trendMap(env)): DayStat {
  const d = dayRow(env, date);
  const meals = mealsFor(env, date);
  const entries = entriesFor(env, date);
  const sum = summary(meals, entries);
  const slots = new Set<MealKey>();
  const skipped = new Set<MealKey>();
  for (const e of entries) if (e.slot !== 'extra') { slots.add(e.slot); if (e.kind === 'skip') skipped.add(e.slot); }
  const w = workoutOn(env, date);
  const runs = runsOn(env, date);
  return {
    date,
    planned: meals.length,
    logged: slots.size,
    skipped: skipped.size,
    kcal: Math.round(sum.eaten),
    protein: Math.round(sum.eatenProtein),
    target: Math.round(adjustedTarget(d.kcal_target ?? env.program.baseKcal, adjustmentsFor(env, date)) + runCredit(env, date)),
    steps: d.steps,
    water: d.water_cups,
    weight: weightOn(env, date),
    trend: trends.get(date) ?? null,
    workout: w ? (w.type as 'home_a' | 'home_b') : null,
    workoutMin: w?.duration_s != null ? Math.round(w.duration_s / 60) : null,
    runs: runs.length,
    runKm: runs.reduce((s, r) => s + r.distance_m, 0) / 1000,
    runMin: runs.reduce((s, r) => s + r.moving_s, 0) / 60,
  };
}

/** Today and the `days - 1` days before it, oldest first. */
export function recentDayStats(env: Env, days = 15): DayStat[] {
  const trends = trendMap(env);
  const today = env.now();
  const out: DayStat[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(dayStat(env, keyOf(addDays(today, -i)), trends));
  return out;
}
