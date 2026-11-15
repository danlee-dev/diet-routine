// Runs by day and the kcal they give back to the day's food budget. Kept apart from run.ts so the day view
// (model.ts) can use it without an import cycle.
import { keyOf, runKcalCredit, RUN_CREDIT_RATIO, type ProfileRow, type RunRow, type WorkoutRow } from '@diet/core';
import type { Env } from './model';

/** Local calendar day a run belongs to (the day it started). */
export const runDate = (r: Pick<RunRow, 'started_at'>): string => keyOf(new Date(r.started_at));

export const runsList = (env: Env): RunRow[] =>
  env.store.all<RunRow>('runs').sort((a, b) => b.started_at.localeCompare(a.started_at));

export const runsOn = (env: Env, date: string): RunRow[] => runsList(env).filter((r) => runDate(r) === date);


/** Share of run kcal given back to the day's food budget. `profiles.preferences.run_credit_ratio` overrides it. */
export function runCreditRatio(env: Env): number {
  const prefs = env.store.get<ProfileRow>('profiles', 'me')?.preferences as Record<string, unknown> | undefined;
  const r = Number(prefs?.run_credit_ratio);
  return prefs?.run_credit_ratio != null && Number.isFinite(r) ? r : RUN_CREDIT_RATIO;
}

/**
 * kcal added to the day's target by that day's runs, and by workouts read from Apple Health (an Apple Watch
 * or another app; source 'health'), which count the same way. Home workouts give nothing back.
 */
export function runCredit(env: Env, date: string): number {
  const ratio = runCreditRatio(env);
  const runs = runsOn(env, date).reduce((s, r) => s + runKcalCredit(r.kcal, ratio), 0);
  const other = env.store.where<WorkoutRow>('workouts', (w) => w.date === date && w.source === 'health')
    .reduce((s, w) => s + runKcalCredit(w.kcal, ratio), 0);
  return runs + other;
}
