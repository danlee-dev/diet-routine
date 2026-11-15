// Day-by-day intake for the Records charts: what was eaten against that day's target.
import { adjustedTarget, programKey, summary } from '@diet/core';
import { dayRow, entriesFor, mealsFor, type Env } from './model';
import { adjustmentsFor } from './plan';
import { runCredit } from './runCredit';

export interface IntakeDay {
  i: number;
  key: string;
  /** kcal and protein logged that day */
  eaten: number;
  protein: number;
  /** that day's target: plan target, carry-over, run credit (same as Today) */
  target: number;
  /** anything logged at all (an empty day is not a 0 kcal day) */
  logged: boolean;
}

/** Program days 0..dayIdx (capped to the program length). */
export function intakeSeries(env: Env, dayIdx: number): IntakeDay[] {
  const out: IntakeDay[] = [];
  const last = Math.min(dayIdx, env.program.days - 1);
  for (let i = 0; i <= last; i++) {
    const key = programKey(env.program, i);
    const entries = entriesFor(env, key);
    const sum = summary(mealsFor(env, key), entries);
    const d = dayRow(env, key);
    out.push({
      i, key, eaten: sum.eaten, protein: sum.eatenProtein, logged: entries.length > 0,
      target: adjustedTarget(d.kcal_target ?? env.program.baseKcal, adjustmentsFor(env, key)) + runCredit(env, key),
    });
  }
  return out;
}
